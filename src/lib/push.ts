import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions, settings, users } from "@/db/schema";
import { eq, inArray, or } from "drizzle-orm";

let ready = false;
let cachedPublicKey = "";
let cachedPrivateKey = "";
let configuredSubject = "";

function isValidVapidPair(pub: string | undefined, priv: string | undefined): boolean {
  if (!pub || !priv || pub === priv) return false;
  try {
    const pubBuf = Buffer.from(pub.trim(), "base64url");
    const privBuf = Buffer.from(priv.trim(), "base64url");
    return pubBuf.length === 65 && privBuf.length === 32;
  } catch {
    return false;
  }
}

export async function getOrInitVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (isValidVapidPair(cachedPublicKey, cachedPrivateKey)) {
    return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
  }

  // 1. فحص متغيرات البيئة
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (isValidVapidPair(envPub, envPriv)) {
    cachedPublicKey = envPub!;
    cachedPrivateKey = envPriv!;
    ready = false;
    return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
  }

  // 2. فحص قاعدة البيانات في جدول settings مع التحقق الصارم من صلاحية الزوج
  try {
    const existing = await db
      .select()
      .from(settings)
      .where(or(eq(settings.key, "vapid_public_key"), eq(settings.key, "vapid_private_key")));

    const pub = existing.find((s) => s.key === "vapid_public_key")?.value?.trim();
    const priv = existing.find((s) => s.key === "vapid_private_key")?.value?.trim();

    if (isValidVapidPair(pub, priv)) {
      cachedPublicKey = pub!;
      cachedPrivateKey = priv!;
      return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
    }

    // 3. توليد زوج مفاتيح VAPID سليم وإصلاح أي قيم قديمة تالفة في settings
    const newKeys = webpush.generateVAPIDKeys();
    cachedPublicKey = newKeys.publicKey;
    cachedPrivateKey = newKeys.privateKey;
    ready = false;

    await db
      .insert(settings)
      .values({ key: "vapid_public_key", value: newKeys.publicKey })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: newKeys.publicKey, updatedAt: new Date() },
      })
      .catch(() => {});

    await db
      .insert(settings)
      .values({ key: "vapid_private_key", value: newKeys.privateKey })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: newKeys.privateKey, updatedAt: new Date() },
      })
      .catch(() => {});

    return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
  } catch (e) {
    console.error("VAPID init error:", e);
    const fallback = webpush.generateVAPIDKeys();
    cachedPublicKey = fallback.publicKey;
    cachedPrivateKey = fallback.privateKey;
    ready = false;
    return fallback;
  }
}

async function ensure(): Promise<boolean> {
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@maestrokey.app";
  if (ready && configuredSubject === subject && isValidVapidPair(cachedPublicKey, cachedPrivateKey)) {
    return true;
  }
  try {
    const { publicKey, privateKey } = await getOrInitVapidKeys();
    if (!isValidVapidPair(publicKey, privateKey)) return false;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configuredSubject = subject;
    ready = true;
    return true;
  } catch (err) {
    ready = false;
    console.error("Failed to ensure webpush VAPID details:", err);
    return false;
  }
}

export type PushSendSummary = {
  total: number;
  sent: number;
  failed: number;
  errors: string[];
};

export async function sendPushToUsers(
  userIds: number[],
  payload: { title: string; body: string; href?: string; tag?: string }
): Promise<PushSendSummary> {
  const ok = await ensure();
  if (!ok || !userIds.length) {
    return { total: 0, sent: 0, failed: 0, errors: ok ? [] : ["VAPID غير مهيأ"] };
  }

  const uniqueIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) return { total: 0, sent: 0, failed: 0, errors: [] };

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, uniqueIds));

  if (!subs.length) return { total: 0, sent: 0, failed: 0, errors: [] };

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          {
            urgency: "high", // ضروري جداً لإيقاظ هواتف أندرويد وآيفون وإظهار الإشعار الفوري في الخلفية
            TTL: 60 * 60 * 24,
            topic: payload.tag ? String(payload.tag).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) : undefined,
          }
        );
        sent++;
      } catch (err: any) {
        failed++;
        const status = Number(err?.statusCode || 0);
        const msg = String(err?.body || err?.message || status || "Push error");
        errors.push(`HTTP ${status || "?"}: ${msg.slice(0, 120)}`);
        // حذف الاشتراكات المنتهية أو غير المطابقة لمفتاح VAPID حتى يعاد تسجيلها تلقائياً
        if (status === 400 || status === 401 || status === 403 || status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).catch(() => {});
        } else {
          console.warn("[webpush] send error:", status || msg);
        }
      }
    })
  );

  return { total: subs.length, sent, failed, errors };
}

export async function adminUserIds() {
  const rows = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users);
  const { isAdminRole } = await import("./roles");
  return rows.filter((r) => r.isActive && isAdminRole(r.role)).map((r) => r.id);
}

export async function employeeUserIds() {
  const rows = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users);
  const { isEmployeeRole } = await import("./roles");
  return rows.filter((r) => r.isActive && isEmployeeRole(r.role)).map((r) => r.id);
}

export { or };
