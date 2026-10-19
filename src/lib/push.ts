import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import { eq, inArray, or } from "drizzle-orm";

let ready = false;
function ensure() {
  if (ready) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:almaystrwbady@gmail.com", publicKey, privateKey);
  ready = true;
}

export async function sendPushToUsers(userIds: number[], payload: { title: string; body: string; href?: string; tag?: string }) {
  ensure();
  if (!ready || !userIds.length) return;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, JSON.stringify(payload));
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
    }
  }));
}

export async function adminUserIds() {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
  return rows.map((r) => r.id);
}

export { or };
