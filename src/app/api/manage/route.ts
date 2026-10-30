import { db } from "@/db";
import { platforms, paymentMethods, users, settings, customers, rentals, payments, auditLogs, pushSubscriptions, alerts, accounts, profiles, walletTransactions, walletBalances } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAdmin, audit, jsonError } from "@/lib/auth";
import { normalizeRole, isAdminRole } from "@/lib/roles";
import { sanitizePermissionsInput } from "@/lib/permissions";
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
      const rawMode = String(b.deliveryMode || "INSTANT_INVENTORY").trim().toUpperCase();
      const deliveryMode = rawMode === "LINK_ONLY" ? "LINK_ONLY"
        : rawMode === "ON_DEMAND_EMAIL" || rawMode === "ON_DEMAND" ? "ON_DEMAND_EMAIL"
        : "INSTANT_INVENTORY";
      const patch: Record<string, unknown> = {
        name,
        color: String(b.color || "#0f172a"),
        shortName: String(b.shortName || name.slice(0, 1) || "▶").slice(0, 4),
        isActive: b.isActive !== false,
        deliveryMode,
        requiresCustomerEmail: deliveryMode === "LINK_ONLY" ? false : (deliveryMode === "ON_DEMAND_EMAIL" ? true : b.requiresCustomerEmail === true),
        extraFieldLabel: typeof b.extraFieldLabel === "string" ? b.extraFieldLabel.trim() || null : undefined,
        isLifetime: b.isLifetime === true,
      };
      if (b.lowStockThreshold !== undefined) {
        const th = Number(b.lowStockThreshold);
        if (Number.isFinite(th) && th >= 0) patch.lowStockThreshold = Math.floor(th);
      }
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
      const role = normalizeRole(b.role);
      const permissions = b.permissions ? sanitizePermissionsInput(b.permissions) : null;
      const [created] = await db.insert(users).values({
        username,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: String(b.displayName || username),
        role,
        permissions,
      }).returning({ id: users.id });
      await db.insert(walletBalances).values({ userId: created.id, balance: 0 }).onConflictDoNothing();
      await notifyAdmin({ title: "إضافة موظف", body: `تم إضافة الموظف ${String(b.displayName || username)}`, kind: "ADDITION", href: "/settings" });
      await audit(admin, "USER_CREATED", "users", created.id, username);
      return Response.json({ ok: true, id: created.id });
    }
    if (action === "updateUser") {
      const id = Number(b.id);
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!target) return jsonError("المستخدم غير موجود", 404);
      const patch: Partial<typeof users.$inferInsert> = {};
      if (b.displayName) patch.displayName = String(b.displayName);
      if (b.role) {
        const nextRole = normalizeRole(b.role);
        if (id === admin.id && nextRole !== "ADMIN") return jsonError("لا يمكنك تخفيض صلاحيات حسابك وأنت داخل النظام");
        if (isAdminRole(target.role) && nextRole !== "ADMIN") {
          const all = await db.select({ id: users.id, role: users.role }).from(users);
          if (all.filter((u) => isAdminRole(u.role)).length <= 1) return jsonError("لا يمكن تخفيض آخر مدير في النظام");
        }
        patch.role = nextRole;
      }
      if (b.isActive !== undefined) {
        if (id === admin.id && !b.isActive) return jsonError("لا يمكنك تعطيل حسابك وأنت داخل النظام");
        if (isAdminRole(target.role) && !b.isActive) {
          const active = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.isActive, true));
          if (active.filter((u) => u.id !== id && isAdminRole(u.role)).length < 1) return jsonError("لا يمكن تعطيل آخر مدير نشط في النظام");
        }
        patch.isActive = !!b.isActive;
      }
      if (b.permissions !== undefined) {
        patch.permissions = sanitizePermissionsInput(b.permissions);
      }
      if (b.password) {
        if (String(b.password).length < 6) return jsonError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل");
        patch.passwordHash = await bcrypt.hash(String(b.password), 10);
      }
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
      if (!id) return jsonError("مستخدم غير صالح");
      if (id === admin.id) return jsonError("لا يمكنك حذف حسابك وأنت داخل النظام");
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!target) return jsonError("المستخدم غير موجود", 404);
      if (isAdminRole(target.role)) {
        const all = await db.select({ id: users.id, role: users.role }).from(users);
        if (all.filter((u) => isAdminRole(u.role)).length <= 1) return jsonError("لا يمكن حذف آخر مدير في النظام");
      }
      try {
        await db.update(rentals).set({ createdBy: admin.id }).where(eq(rentals.createdBy, id));
        await db.update(rentals).set({ activatedBy: admin.id }).where(eq(rentals.activatedBy, id));
        await db.update(payments).set({ createdBy: admin.id }).where(eq(payments.createdBy, id));
        await db.update(payments).set({ reviewedBy: admin.id }).where(eq(payments.reviewedBy, id));
        await db.update(auditLogs).set({ userId: admin.id }).where(eq(auditLogs.userId, id));
        await db.update(profiles).set({ soldBy: admin.id }).where(eq(profiles.soldBy, id));
        await db.update(walletTransactions).set({ createdBy: admin.id }).where(eq(walletTransactions.createdBy, id));
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, id));
        await db.delete(alerts).where(eq(alerts.forUserId, id));
        await db.delete(users).where(eq(users.id, id));
      } catch {
        return jsonError("تعذر حذف المستخدم — مرتبط ببيانات لا يمكن نقلها. عطّله بدلاً من الحذف.", 500);
      }
      await audit(admin, "USER_DELETED", "users", id, `حذف المستخدم ${target.username}`);
      return Response.json({ ok: true, username: target.username });
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
