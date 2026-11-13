import { db, getDbStatus } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    const status = getDbStatus();
    return Response.json({
      ok: true,
      mode: status.mode,
      hasStandbyBackup: status.hasBackup,
    });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
