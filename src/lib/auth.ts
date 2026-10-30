import { cookies } from "next/headers";
import { db } from "@/db";
import { users, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifySession } from "./crypto";
import { isAdminRole } from "./roles";
import { hasPermission, type PermissionKey } from "./permissions";

export type CurrentUser = typeof users.$inferSelect;

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const store = await cookies();
    const token = store.get("maestro_session")?.value;
    if (!token) return null;

    const session = verifySession(token);
    if (!session || !session.userId) {
      try { store.delete("maestro_session"); } catch { /* سياق قراءة فقط */ }
      return null;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user || !user.isActive) {
      try { store.delete("maestro_session"); } catch { /* مسح الجلسة القديمة */ }
      return null;
    }

    return user;
  } catch (error: any) {
    if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
    console.error("Session verification error handled safely:", error);
    try {
      const store = await cookies();
      store.delete("maestro_session");
    } catch { /* no-op */ }
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Response(
      JSON.stringify({ error: "غير مصرح — سجل الدخول أولاً" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  // فحص موحّد غير حساس لحالة الأحرف (ADMIN/admin) — أي دور غير مدير يُرفض
  if (!isAdminRole(user.role)) {
    throw new Response(
      JSON.stringify({ error: "هذه الصلاحية للمدير فقط" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }
  return user;
}

export async function requirePermission(key: PermissionKey, customMessage?: string) {
  const user = await requireUser();
  if (!hasPermission(user, key)) {
    throw new Response(
      JSON.stringify({ error: customMessage || "ليست لديك صلاحية لتنفيذ هذا الإجراء" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }
  return user;
}

export async function audit(
  user: { id?: number | null; username?: string | null } | null,
  action: string,
  entityType?: string,
  entityId?: number | null,
  details?: string,
) {
  try {
    await db.insert(auditLogs).values({
      userId: user?.id ?? null,
      username: user?.username ?? null,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      details: details ?? null,
    });
  } catch {
    /* audit must never break main flow */
  }
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
