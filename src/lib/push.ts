import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions, settings, users } from "@/db/schema";
import { eq, inArray, or } from "drizzle-orm";

let ready = false;
let cachedPublicKey = "";
let cachedPrivateKey = "";

export async function getOrInitVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cachedPublicKey && cachedPrivateKey) {
    return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
  }

  // 1. فحص متغيرات البيئة
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedPublicKey = process.env.VAPID_PUBLIC_KEY;
    cachedPrivateKey = process.env.VAPID_PRIVATE_KEY;
    return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
  }

  // 2. فحص قاعدة البيانات في جدول settings
  try {
    const existing = await db
      .select()
      .from(settings)
      .where(or(eq(settings.key, "vapid_public_key"), eq(settings.key, "vapid_private_key")));
    
    const pub = existing.find((s) => s.key === "vapid_public_key")?.value;
    const priv = existing.find((s) => s.key === "vapid_private_key")?.value;

    if (pub && priv) {
      cachedPublicKey = pub;
      cachedPrivateKey = priv;
      return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
    }

    // 3. توليد زوج مفاتيح VAPID جديد وحفظه بشكل دائم
    const newKeys = webpush.generateVAPIDKeys();
    cachedPublicKey = newKeys.publicKey;
    cachedPrivateKey = newKeys.privateKey;

    await db.insert(settings).values([
      { key: "vapid_public_key", value: newKeys.publicKey },
      { key: "vapid_private_key", value: newKeys.privateKey },
    ]).onConflictDoUpdate({
      target: settings.key,
      set: { value: newKeys.publicKey, updatedAt: new Date() },
    }).catch(() => {});

    return { publicKey: cachedPublicKey, privateKey: cachedPrivateKey };
  } catch (e) {
    console.error("VAPID init error:", e);
    // إذا حدث خطأ غير متوقع في قاعدة البيانات نولد مفاتيح في الذاكرة
    const fallback = webpush.generateVAPIDKeys();
    cachedPublicKey = fallback.publicKey;
    cachedPrivateKey = fallback.privateKey;
    return fallback;
  }
}

async function ensure() {
  if (ready) return;
  try {
    const { publicKey, privateKey } = await getOrInitVapidKeys();
    if (!publicKey || !privateKey) return;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@maestrokey.app",
      publicKey,
      privateKey
    );
    ready = true;
  } catch (err) {
    console.error("Failed to ensure webpush VAPID details:", err);
  }
}

export async function sendPushToUsers(
  userIds: number[],
  payload: { title: string; body: string; href?: string; tag?: string }
) {
  await ensure();
  if (!ready || !userIds.length) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));

  if (!subs.length) return;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
      } catch (err: any) {
        // حذف الاشتراكات المنتهية أو غير الصالحة تلقائياً
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).catch(() => {});
        }
      }
    })
  );
}

export async function adminUserIds() {
  const rows = await db.select({ id: users.id, role: users.role }).from(users);
  const { isAdminRole } = await import("./roles");
  return rows.filter((r) => isAdminRole(r.role)).map((r) => r.id);
}

export async function employeeUserIds() {
  const rows = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users);
  const { isEmployeeRole } = await import("./roles");
  return rows.filter((r) => r.isActive && isEmployeeRole(r.role)).map((r) => r.id);
}

export { or };
