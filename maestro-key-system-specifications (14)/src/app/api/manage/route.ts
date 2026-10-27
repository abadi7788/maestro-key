import { db } from "@/db";
import { platforms, paymentMethods, users, settings, customers, rentals, payments, auditLogs, pushSubscriptions, alerts, accounts } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAdmin, audit, jsonError } from "@/lib/auth";
import { encryptText } from "@/lib/crypto";
import { ensureSeeded } from "@/lib/seed";
import { notifyAdmin } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const admin = await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");

    if (action === "upsertPlatform") {
      const name = String(b.name || "").trim(); if (!name) return jsonError("اسم المنصة مطلوب");
      const imageUrl = typeof b.imageUrl === "string" ? b.imageUrl : undefined;
      if (imageUrl && imageUrl.length > 1_800_000) return jsonError("صورة المنصة كبيرة جداً، اختر صورة أصغر");
      if (imageUrl && !imageUrl.startsWith("data:image") && !imageUrl.startsWith("/")) return jsonError("صيغة الصورة غير مدعومة");
      const patch: Record<string, unknown> = {
        name,
        color: String(b.color || "#0f172a"),
        shortName: String(b.shortName || name.slice(0, 1) || "▶").slice(0, 4),
        isActive: b.isActive !== false,
        deliveryMode: b.deliveryMode === "ON_DEMAND" ? "ON_DEMAND" : "INVENTORY",
        requiresCustomerEmail: b.requiresCustomerEmail === true,
        extraFieldLabel: typeof b.extraFieldLabel === "string" ? b.extraFieldLabel.trim() || null : undefined,
      };
      if (imageUrl !== undefined) patch.imageUrl = imageUrl || null;
      if (b.id) await db.update(platforms).set(patch).where(eq(platforms.id, Number(b.id)));
      else {
        await db.insert(platforms).values(patch as typeof platforms.$inferInsert);
        await notifyAdmin({ title: "إضافة منصة", body: `تم إضافة منصة ${name}`, kind: "ADDITION", href: "/settings" });
      }
      await audit(admin, "PLATFORM_MANAGED", "platforms", b.id ?? null, name);
      return Response.json({ ok: true });
    }
    if (action === "upsertBank") {
      const name = String(b.name || "").trim(); if (!name) return jsonError("اسم البنك مطلوب");
      if (b.id) await db.update(paymentMethods).set({ name, isActive: b.isActive !== false }).where(eq(paymentMethods.id, Number(b.id)));
      else await db.insert(paymentMethods).values({ name });
      await audit(admin, "BANK_MANAGED", "payment_methods", b.id ?? null, name);
      return Response.json({ ok: true });
    }
    if (action === "createUser") {
      const username = String(b.username || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!username || password.length < 6) return jsonError("اسم مستخدم وكلمة مرور (6 أحرف على الأقل) مطلوبة");
      const exists = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
      if (exists.length) return jsonError("اسم المستخدم موجود مسبقاً", 409);
      await db.insert(users).values({ username, passwordHash: await bcrypt.hash(password, 10), displayName: String(b.displayName || username), role: b.role === "ADMIN" ? "ADMIN" : "EMPLOYEE" });
      await notifyAdmin({ title: "إضافة موظف", body: `تم إضافة الموظف ${String(b.displayName || username)}`, kind: "ADDITION", href: "/settings" });
      await audit(admin, "USER_CREATED", "users", null, username);
      return Response.json({ ok: true });
    }
    if (action === "updateUser") {
      const id = Number(b.id);
      const patch: Partial<typeof users.$inferInsert> = {};
      if (b.displayName) patch.displayName = String(b.displayName);
      if (b.role) patch.role = b.role === "ADMIN" ? "ADMIN" : "EMPLOYEE";
      if (b.isActive !== undefined) patch.isActive = !!b.isActive;
      if (b.password) patch.passwordHash = await bcrypt.hash(String(b.password), 10);
      if (b.unlock) { patch.failedAttempts = 0; patch.lockedUntil = null; }
      await db.update(users).set(patch).where(eq(users.id, id));
      await audit(admin, "USER_UPDATED", "users", id, JSON.stringify(Object.keys(patch)));
      return Response.json({ ok: true });
    }
    if (action === "upsertCustomer") {
      const name = String(b.name || "").trim(); const phone = String(b.phone || "").replace(/\s/g, "").trim();
      if (!name || !phone) return jsonError("اسم العميل ورقم هاتفه مطلوبان");
      if (!/^\+?\d{7,15}$/.test(phone)) return jsonError("رقم الهاتف غير صالح (أرقام فقط، 7-15 خانة)");
      const dup = await db.select({ id: customers.id }).from(customers)
        .where(b.id ? and(eq(customers.phone, phone), ne(customers.id, Number(b.id))) : eq(customers.phone, phone)).limit(1);
      if (dup.length) return jsonError("يوجد عميل آخر مسجل بنفس هذا الرقم", 409);
      if (b.id) {
        await db.update(customers).set({ name, phone, notes: b.notes !== undefined ? String(b.notes) : undefined }).where(eq(customers.id, Number(b.id)));
        await audit(admin, "CUSTOMER_UPDATED", "customers", Number(b.id), `${name} — ${phone}`);
      } else {
        await db.insert(customers).values({ name, phone, notes: b.notes ? String(b.notes) : null });
        await audit(admin, "CUSTOMER_CREATED", "customers", null, `${name} — ${phone}`);
      }
      return Response.json({ ok: true });
    }
    if (action === "deleteUser") {
      const id = Number(b.id);
      if (id === admin.id) return jsonError("لا يمكنك حذف حسابك وأنت داخل النظام");
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!target) return jsonError("المستخدم غير موجود", 404);
      if (target.role === "ADMIN") {
        const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
        if (admins.length <= 1) return jsonError("لا يمكن حذف آخر مدير في النظام");
      }
      try {
        await db.transaction(async (tx) => {
          // Reassign historical records to the acting admin (preserve financial/audit trail)
          await tx.update(rentals).set({ createdBy: admin.id }).where(eq(rentals.createdBy, id));
          await tx.update(rentals).set({ activatedBy: admin.id }).where(eq(rentals.activatedBy, id));
          await tx.update(payments).set({ createdBy: admin.id }).where(eq(payments.createdBy, id));
          await tx.update(payments).set({ reviewedBy: admin.id }).where(eq(payments.reviewedBy, id));
          await tx.update(auditLogs).set({ userId: admin.id }).where(eq(auditLogs.userId, id));
          // Delete user-owned device subscriptions and targeted alerts
          await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, id));
          await tx.delete(alerts).where(eq(alerts.forUserId, id));
          await tx.delete(users).where(eq(users.id, id));
        });
      } catch (e: any) {
        return jsonError("تعذر حذف الموظف: " + (e?.message || "خطأ غير متوقع"), 500);
      }
      await audit(admin, "USER_DELETED", "users", id, `حذف المستخدم ${target.username}`);
      return Response.json({ ok: true });
    }
    if (action === "deleteBank") {
      const id = Number(b.id);
      const used = await db.select({ id: payments.id }).from(payments).where(eq(payments.paymentMethodId, id)).limit(1);
      const [bank] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1);
      if (!bank) return jsonError("البنك غير موجود", 404);
      if (used.length) {
        await db.update(paymentMethods).set({ isActive: false }).where(eq(paymentMethods.id, id));
        await audit(admin, "BANK_HIDDEN", "payment_methods", id, `إخفاء ${bank.name} لأنه مرتبط بسندات`);
        return Response.json({ ok: true, hidden: true, message: "تم إخفاء البنك لأنه مرتبط بسندات قديمة" });
      }
      await db.delete(paymentMethods).where(eq(paymentMethods.id, id));
      await audit(admin, "BANK_DELETED", "payment_methods", id, `حذف ${bank.name}`);
      return Response.json({ ok: true });
    }
    if (action === "deletePlatform") {
      const id = Number(b.id);
      const used = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.platformId, id)).limit(1);
      if (used.length) return jsonError("لا يمكن حذف منصة عليها حسابات. انقل الحسابات أو احذفها أولاً");
      const [plat] = await db.select().from(platforms).where(eq(platforms.id, id)).limit(1);
      await db.delete(platforms).where(eq(platforms.id, id));
      await audit(admin, "PLATFORM_DELETED", "platforms", id, `حذف المنصة ${plat?.name || id}`);
      return Response.json({ ok: true });
    }
    if (action === "deleteCustomer") {
      const id = Number(b.id);
      const used = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, id)).limit(1);
      if (used.length) return jsonError("لا يمكن حذف عميل له اشتراكات مسجلة");
      await db.delete(customers).where(eq(customers.id, id));
      await audit(admin, "CUSTOMER_DELETED", "customers", id, "حذف عميل");
      return Response.json({ ok: true });
    }
    if (action === "deleteAudit") {
      if (b.all) {
        await db.delete(auditLogs);
        return Response.json({ ok: true });
      }
      await db.delete(auditLogs).where(eq(auditLogs.id, Number(b.id)));
      return Response.json({ ok: true });
    }
    if (action === "saveSettings") {
      const entries = Object.entries(b.settings || {}) as [string, string][];
      for (const [key, value] of entries) {
        if (key === "smtp_pass" && !String(value || "").trim()) continue;
        const stored = key === "smtp_pass" && value && !String(value).startsWith("v1:") ? encryptText(String(value)) : String(value);
        const exists = await db.select({ id: settings.id }).from(settings).where(eq(settings.key, key)).limit(1);
        if (exists.length) await db.update(settings).set({ value: stored, updatedAt: new Date() }).where(eq(settings.key, key));
        else await db.insert(settings).values({ key, value: stored });
      }
      await audit(admin, "SETTINGS_UPDATED", "settings", null, entries.map(([k]) => k).join(","));
      return Response.json({ ok: true });
    }
    return jsonError("إجراء غير معروف");
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}
