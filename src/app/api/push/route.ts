import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { requireUser, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { getOrInitVapidKeys } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    const keys = await getOrInitVapidKeys();
    return Response.json({ publicKey: keys.publicKey });
  } catch {
    return jsonError("فشل استخراج مفتاح الإشعارات", 500);
  }
}

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    const sub = await req.json();
    const endpoint = String(sub?.endpoint || "").trim();
    const p256dh = String(sub?.keys?.p256dh || "").trim();
    const auth = String(sub?.keys?.auth || "").trim();

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
