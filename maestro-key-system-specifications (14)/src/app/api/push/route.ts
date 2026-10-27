import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const sub = await req.json();
    const endpoint = String(sub?.endpoint || "");
    const p256dh = String(sub?.keys?.p256dh || "");
    const auth = String(sub?.keys?.auth || "");
    if (!endpoint || !p256dh || !auth) return jsonError("اشتراك الإشعار غير مكتمل");
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    await db.insert(pushSubscriptions).values({ userId: user.id, endpoint, p256dh, auth });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("تعذر حفظ الإشعار", 500);
  }
}
