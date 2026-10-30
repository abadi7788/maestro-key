import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser, requireUser, jsonError } from "@/lib/auth";
import { notifyAdmin } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const configured = !!(publicKey && process.env.VAPID_PRIVATE_KEY);
  let subscribedDevices = 0;
  try {
    const user = await getCurrentUser();
    if (user) {
      const subs = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, user.id));
      subscribedDevices = subs.length;
    }
  } catch {}
  return Response.json({ publicKey, configured, subscribedDevices });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = await req.json().catch(() => ({}));

    if (b?.action === "test") {
      const subs = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, user.id));
      await notifyAdmin({
        title: "🔔 إشعار تجريبي — مايسترو كي",
        body: "الإشعارات الفورية والتنبيهات الصوتية تعمل بنجاح على جهازك ✓",
        kind: "TEST",
        href: "/settings?tab=push",
        forUserId: user.id,
      });
      return Response.json({ ok: true, sent: subs.length });
    }

    if (b?.action === "unsubscribe") {
      const ep = String(b?.endpoint || "");
      if (ep) {
        await db
          .delete(pushSubscriptions)
          .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, ep)));
      } else {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
      }
      return Response.json({ ok: true });
    }

    const endpoint = String(b?.endpoint || "");
    const p256dh = String(b?.keys?.p256dh || "");
    const auth = String(b?.keys?.auth || "");
    if (!endpoint || !p256dh || !auth) return jsonError("اشتراك الإشعار غير مكتمل");
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    await db.insert(pushSubscriptions).values({ userId: user.id, endpoint, p256dh, auth });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("تعذر حفظ الإشعار", 500);
  }
}
