export async function api<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "حدث خطأ"), { status: res.status, data });
  return data as T;
}

export type Me = {
  id: number;
  username: string;
  displayName: string;
  role: "ADMIN" | "EMPLOYEE" | string;
  permissions?: string | null;
  walletBalance?: number;
};

/* ---------------- Client SWR Cache + Request Deduplication ---------------- */
type CacheEntry<T = any> = { data: T; ts: number };
const memCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<any>>();
const STORAGE_PREFIX = "mk_swr_v1:";
const DEFAULT_STORAGE_TTL = 10 * 60 * 1000; // 10 min

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function getCached<T = any>(key: string, maxAgeMs = DEFAULT_STORAGE_TTL): T | null {
  const hit = memCache.get(key);
  if (hit) {
    if (Date.now() - hit.ts <= maxAgeMs) return hit.data as T;
  }
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > maxAgeMs) {
      window.sessionStorage.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    memCache.set(key, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

export function setCached<T = any>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, ts: Date.now() };
  memCache.set(key, entry);
  if (!canUseStorage()) return;
  try {
    const serialized = JSON.stringify(entry);
    // Avoid exceeding sessionStorage quota on massive payloads
    if (serialized.length < 400_000) {
      window.sessionStorage.setItem(STORAGE_PREFIX + key, serialized);
    }
  } catch {
    // Ignore quota errors cleanly
  }
}

export function mutateCache<T = any>(keyOrPrefix: string, updater: (prev: T) => T): void {
  const matchedKeys = new Set<string>();
  for (const k of memCache.keys()) {
    if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) matchedKeys.add(k);
  }
  if (canUseStorage()) {
    try {
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const sk = window.sessionStorage.key(i);
        if (sk && sk.startsWith(STORAGE_PREFIX)) {
          const rawKey = sk.slice(STORAGE_PREFIX.length);
          if (rawKey === keyOrPrefix || rawKey.startsWith(keyOrPrefix)) matchedKeys.add(rawKey);
        }
      }
    } catch {}
  }
  for (const k of matchedKeys) {
    const prev = getCached<T>(k);
    if (prev !== null) setCached(k, updater(prev));
  }
}

export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    clearClientCache();
    return;
  }
  for (const k of Array.from(memCache.keys())) {
    if (k === prefix || k.startsWith(prefix)) memCache.delete(k);
  }
  if (canUseStorage()) {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const sk = window.sessionStorage.key(i);
        if (sk && sk.startsWith(STORAGE_PREFIX)) {
          const rawKey = sk.slice(STORAGE_PREFIX.length);
          if (rawKey === prefix || rawKey.startsWith(prefix)) toRemove.push(sk);
        }
      }
      for (const sk of toRemove) window.sessionStorage.removeItem(sk);
    } catch {}
  }
}

export function clearClientCache(): void {
  memCache.clear();
  inFlight.clear();
  if (!canUseStorage()) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const sk = window.sessionStorage.key(i);
      if (sk && sk.startsWith(STORAGE_PREFIX)) toRemove.push(sk);
    }
    for (const sk of toRemove) window.sessionStorage.removeItem(sk);
  } catch {}
}

/**
 * Stale-While-Revalidate fetch with in-flight request deduplication.
 * Immediately returns fresh network data and updates cache, while optionally invoking onData synchronously if cached.
 */
export async function cachedApi<T = any>(
  url: string,
  onData?: (data: T, fromCache: boolean) => void,
  opts?: { force?: boolean; staleTimeMs?: number }
): Promise<T> {
  const cached = getCached<T>(url);
  if (cached !== null && onData) {
    onData(cached, true);
  }

  // If fresh enough and not forced, avoid redundant burst calls within 1.5s
  const entry = memCache.get(url);
  const staleTimeMs = opts?.staleTimeMs ?? 1500;
  if (!opts?.force && entry && Date.now() - entry.ts < staleTimeMs) {
    return entry.data as T;
  }

  let req = inFlight.get(url);
  if (!req) {
    req = api<T>(url)
      .then((fresh) => {
        setCached(url, fresh);
        return fresh;
      })
      .finally(() => {
        inFlight.delete(url);
      });
    inFlight.set(url, req);
  }

  const fresh = await req;
  if (onData) onData(fresh, false);
  return fresh;
}

export function getCachedMe(): Me | null {
  return getCached<Me>("/api/auth", 15 * 60 * 1000);
}

export async function fetchMe(force = false): Promise<Me | null> {
  const entry = memCache.get("/api/auth");
  if (!force && entry && Date.now() - entry.ts < 30_000) {
    return entry.data as Me;
  }
  const key = "__me_fetch__";
  let req = inFlight.get(key);
  if (!req) {
    req = api<{ user: Me }>("/api/auth")
      .then((d) => {
        setCached("/api/auth", d.user);
        return d.user;
      })
      .catch(() => null)
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, req);
  }
  return req;
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v); if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-YE", { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v); if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-YE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function daysLeft(end: string) { return Math.ceil((new Date(end).getTime() - Date.now()) / 86400000); }
export function money(n: number) { return (n || 0).toLocaleString("ar-YE") + " ر.ي"; }
export function waLink(phone: string, message: string) {
  let p = (phone || "").replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.length === 9 && p.startsWith("7")) p = "967" + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

/** Compress an image file to a JPEG data URL (max 1100px) to keep receipts light. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1100; const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d"); if (!ctx) return resolve(String(reader.result));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => resolve(String(reader.result));
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
