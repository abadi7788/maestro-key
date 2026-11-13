import crypto from "node:crypto";

const STORAGE_PREFIX = "sb://";

const globalForStorage = globalThis as typeof globalThis & {
  __maestroReceiptsBucketReady?: boolean;
};

function getConfig() {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bucket = (process.env.SUPABASE_RECEIPTS_BUCKET || "receipts").trim();
  return { url, key, bucket };
}

export function isSupabaseStorageConfigured(): boolean {
  const { url, key } = getConfig();
  return Boolean(url && key);
}

export function isStorageRef(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(STORAGE_PREFIX);
}

export function parseDataUrlImage(dataUrl: string): {
  mimeType: string;
  ext: string;
  buffer: Buffer;
} | null {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, "");
  const ext =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : mimeType === "image/gif"
          ? "gif"
          : "jpg";
  return { mimeType, ext, buffer: Buffer.from(base64, "base64") };
}

async function ensureReceiptsBucket(): Promise<void> {
  if (globalForStorage.__maestroReceiptsBucketReady) return;
  const { url, key, bucket } = getConfig();
  if (!url || !key) return;

  try {
    const check = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(6000),
    });
    if (check.ok) {
      globalForStorage.__maestroReceiptsBucketReady = true;
      return;
    }

    const created = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: false,
        file_size_limit: 5 * 1024 * 1024,
        allowed_mime_types: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (created.ok || created.status === 409) {
      globalForStorage.__maestroReceiptsBucketReady = true;
    }
  } catch (err) {
    console.warn("[Supabase Storage] Bucket check warning:", err instanceof Error ? err.message : err);
  }
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function parseStorageRef(ref: string): { bucket: string; objectPath: string } | null {
  if (!isStorageRef(ref)) return null;
  const rest = ref.slice(STORAGE_PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0) return null;
  return {
    bucket: rest.slice(0, slashIdx),
    objectPath: rest.slice(slashIdx + 1),
  };
}

/**
 * رفع صورة السند مؤقتاً إلى Supabase Storage وإرجاع مرجع مختصر (sb://...)
 * إذا لم تكن متغيرات Supabase Storage مضبوطة بعد، يُرجع البيانات الأصلية كخيار احتياطي آمن.
 */
export async function uploadTempReceipt(dataUrl: string, refHint = "receipt"): Promise<string> {
  if (!isSupabaseStorageConfigured()) {
    console.warn("[Supabase Storage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — falling back to inline data URL.");
    return dataUrl;
  }

  const parsed = parseDataUrlImage(dataUrl);
  if (!parsed) return dataUrl;

  const { url, key, bucket } = getConfig();
  await ensureReceiptsBucket();

  const safeHint = refHint.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "receipt";
  const objectPath = `pending/${Date.now()}-${safeHint}-${crypto.randomUUID().slice(0, 8)}.${parsed.ext}`;

  const res = await fetch(
    `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "content-type": parsed.mimeType,
        "x-upsert": "true",
      },
      body: new Uint8Array(parsed.buffer),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`فشل رفع السند مؤقتاً إلى التخزين السحابي (${res.status}): ${errText.slice(0, 140)}`);
  }

  return `${STORAGE_PREFIX}${bucket}/${objectPath}`;
}

/**
 * تحميل صورة السند المؤقتة من Supabase Storage كـ Buffer و Data URL للعرض أو النقل لتيليجرام.
 */
export async function downloadReceiptFromStorage(
  storageRef: string
): Promise<{ buffer: Buffer; mimeType: string; dataUrl: string } | null> {
  const target = parseStorageRef(storageRef);
  if (!target) return null;

  const { url, key } = getConfig();
  if (!url || !key) return null;

  const res = await fetch(
    `${url}/storage/v1/object/${encodeURIComponent(target.bucket)}/${encodeObjectPath(target.objectPath)}`,
    {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!res.ok) {
    console.warn(`[Supabase Storage] Failed to download ${storageRef}: HTTP ${res.status}`);
    return null;
  }

  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  return { buffer, mimeType, dataUrl };
}

/**
 * حذف صورة السند المؤقتة فوراً من Supabase Storage لتظل المساحة نظيفة تماماً.
 */
export async function deleteReceiptFromStorage(storageRef: string | null | undefined): Promise<boolean> {
  const target = storageRef ? parseStorageRef(storageRef) : null;
  if (!target) return false;

  const { url, key } = getConfig();
  if (!url || !key) return false;

  try {
    const res = await fetch(
      `${url}/storage/v1/object/${encodeURIComponent(target.bucket)}/${encodeObjectPath(target.objectPath)}`,
      {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    return res.ok || res.status === 404;
  } catch (err) {
    console.warn(`[Supabase Storage] Failed to delete ${storageRef}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
