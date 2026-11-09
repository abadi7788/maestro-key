import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, jsonError } from "@/lib/auth";
import { getOrInitVapidKeys } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const keys = await getOrInitVapidKeys();
    return Response.json({ publicKey: keys.publicKey });
  } catch (err: any) {
    return jsonError("فشل استخراج مفتاح الإشعارات", 500);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const sub = await req.json();
    const endpoint = String(sub?.endpoint || "");
    const p256dh = String(sub?.keys?.p256dh || "");
    const auth = String(sub?.keys?.auth || "");
    
    if (!endpoint || !p256dh || !auth) {
      return jsonError("اشتراك الإشعار غير مكتمل");
    }

    // إزالة أي تسجيل سابق لنفس المتصفح لتحديثه بالمعرف الجديد
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    
    // إدراج الاشتراك وربطه بـ user.id
    await db.insert(pushSubscriptions).values({
      userId: user.id,
      endpoint,
      p256dh,
      auth,
    });

    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("تعذر حفظ اشتراك الإشعار", 500);
  }
}
