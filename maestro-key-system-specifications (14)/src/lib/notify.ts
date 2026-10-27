import { db } from "@/db";
import { alerts } from "@/db/schema";
import { adminUserIds, sendPushToUsers } from "@/lib/push";

export async function notifyAdmin(input: { title: string; body: string; kind?: string; href?: string; forUserId?: number | null }) {
  try {
    await db.insert(alerts).values({
      title: input.title,
      body: input.body,
      kind: input.kind || "INFO",
      href: input.href || "/inbox",
      forUserId: input.forUserId ?? null,
    });
    const ids = input.forUserId ? [input.forUserId] : await adminUserIds();
    await sendPushToUsers(ids, {
      title: input.title,
      body: input.body,
      href: input.href || "/inbox",
      tag: `${input.kind || "INFO"}-${Date.now()}`,
    });
  } catch (err) {
    console.error("notify failed", err);
  }
}
