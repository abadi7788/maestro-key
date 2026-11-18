import { db } from "@/db";
import { alerts, pushSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, requireUser, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { getOrInitVapidKeys, sendPushToUsers } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    const [keys, user] = await Promise.all([
      getOrInitVapidKeys(),
      getCurrentUser().catch(() => null),
    ]);

    let deviceCount = 0;
    if (user) {
      const subs = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, user.id));
      deviceCount = subs.length;
    }

    return Response.json({ publicKey: keys.publicKey, deviceCount });
  } catch {
    return jsonError("فشل استخراج مفتاح الإشعارات", 500);
  }
}

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));

    // اختبار إرسال إشعار فوري للخلفية والجرس
    if (body?.action === "test") {
      const title = "🔔 اختبار إشعار مايسترو كي";
      const msgBody = "إذا وصلك هذا التنبيه مع الصوت، فإن إشعارات الخلفية والهاتف تعمل بنجاح!";

      const [alertRow] = await db
        .insert(alerts)
        .values({
          title,
          body: msgBody,
          kind: "INFO",
          href: "/inbox",
          forUserId: user.id,
        })
        .returning({ id: alerts.id });

      const summary = await sendPushToUsers([user.id], {
        title,
        body: msgBody,
        href: "/inbox",
        tag: `test-push-${Date.now()}`,
      });

      return Response.json({
        ok: true,
        alertId: alertRow?.id ?? null,
        ...summary,
      });
    }

    const endpoint = String(body?.endpoint || "").trim();
    const p256dh = String(body?.keys?.p256dh || "").trim();
    const auth = String(body?.keys?.auth || "").trim();

    if (!endpoint || !p256dh || !auth) {
      return jsonError("اشتراك الإشعار غير مكتمل");
    }

    // إدراج أو تحديث الاشتراك ذرياً عبر endpoint لمنع التكرار أو أخطاء السباق
    await db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint,
        p256dh,
        auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: user.id,
          p256dh,
          auth,
        },
      });

    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("تعذر حفظ اشتراك الإشعار", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    await ensureSeeded();
    await requireUser();
    const body = await req.json().catch(() => ({}));
    const endpoint = String(body?.endpoint || "").trim();
    if (endpoint) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("تعذر حذف الاشتراك", 500);
  }
}
