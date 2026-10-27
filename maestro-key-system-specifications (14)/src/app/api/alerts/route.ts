import { db } from "@/db";
import { alerts } from "@/db/schema";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { requireUser, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    const after = Number(new URL(req.url).searchParams.get("after") || 0);
    const mine = user.role === "ADMIN"
      ? or(isNull(alerts.forUserId), eq(alerts.forUserId, user.id))
      : eq(alerts.forUserId, user.id);
    const rows = await db.select().from(alerts).where(and(gt(alerts.id, after), mine)).orderBy(desc(alerts.id)).limit(20);
    const latest = await db.select({ id: alerts.id }).from(alerts).where(mine).orderBy(desc(alerts.id)).limit(1);
    return Response.json({ alerts: rows.reverse(), latestId: latest[0]?.id || 0 });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("خطأ في الإشعارات", 500);
  }
}
