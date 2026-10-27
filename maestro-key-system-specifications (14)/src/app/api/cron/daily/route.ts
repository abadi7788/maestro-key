import { ensureSeeded } from "@/lib/seed";
import { runDailyJob } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Daily job endpoint — schedule at 09:00 Asia/Aden. Protect with CRON_SECRET in production. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) return Response.json({ error: "forbidden" }, { status: 403 });
  await ensureSeeded();
  const result = await runDailyJob({ sendAlerts: true });
  return Response.json({ ok: true, ...result });
}
export async function GET(req: Request) { return POST(req); }
