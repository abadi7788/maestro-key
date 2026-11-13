import { after } from "next/server";
import { db, pool } from "@/db";
import {
  accounts,
  customers,
  paymentMethods,
  payments,
  platforms,
  profiles,
  rentals,
  settings,
  users,
  walletBalances,
  walletTransactions,
  whatsappLogs,
} from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { resolveTelegramArchiveConfig, sendDocumentToTelegramArchive } from "./telegram";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const LAST_BACKUP_SETTING_KEY = "last_telegram_backup_at";

const globalForBackup = globalThis as unknown as {
  __mkLastTelegramBackupAt?: number;
  __mkBackupInFlight?: boolean;
};

export type BackupPayload = {
  version: number;
  app: string;
  exportedAt: string;
  counts: Record<string, number>;
  tables: {
    platforms: any[];
    payment_methods: any[];
    paymentMethods: any[];
    users: any[];
    customers: any[];
    accounts: any[];
    profiles: any[];
    rentals: any[];
    payments: any[];
    settings: any[];
    wallet_balances: any[];
    walletBalances: any[];
    wallet_transactions: any[];
    walletTransactions: any[];
    whatsapp_logs: any[];
    whatsappLogs: any[];
  };
};

function sanitizeReceiptForBackup(val: string | null | undefined): string | null {
  if (!val) return null;
  if (val.startsWith("data:image")) return null;
  return val;
}

export async function buildFullBackupPayload(): Promise<BackupPayload> {
  const [
    plats,
    banks,
    usrs,
    custs,
    accs,
    profs,
    rents,
    pays,
    sets,
    wBals,
    wTxs,
    waLogs,
  ] = await Promise.all([
    db.select().from(platforms).orderBy(asc(platforms.id)),
    db.select().from(paymentMethods).orderBy(asc(paymentMethods.id)),
    db.select().from(users).orderBy(asc(users.id)),
    db.select().from(customers).orderBy(asc(customers.id)),
    db.select().from(accounts).orderBy(asc(accounts.id)),
    db.select().from(profiles).orderBy(asc(profiles.id)),
    db.select().from(rentals).orderBy(asc(rentals.id)),
    db.select().from(payments).orderBy(asc(payments.id)),
    db.select().from(settings).orderBy(asc(settings.id)),
    db.select().from(walletBalances),
    db.select().from(walletTransactions).orderBy(asc(walletTransactions.id)),
    db.select().from(whatsappLogs).orderBy(asc(whatsappLogs.id)),
  ]);

  const cleanPays = pays.map((p) => ({
    ...p,
    receiptImageData: sanitizeReceiptForBackup(p.receiptImageData),
  }));

  return {
    version: 2,
    app: "Maestro Key",
    exportedAt: new Date().toISOString(),
    counts: {
      platforms: plats.length,
      paymentMethods: banks.length,
      users: usrs.length,
      customers: custs.length,
      accounts: accs.length,
      profiles: profs.length,
      rentals: rents.length,
      payments: cleanPays.length,
      settings: sets.length,
    },
    tables: {
      platforms: plats,
      payment_methods: banks,
      paymentMethods: banks,
      users: usrs,
      customers: custs,
      accounts: accs,
      profiles: profs,
      rentals: rents,
      payments: cleanPays,
      settings: sets,
      wallet_balances: wBals,
      walletBalances: wBals,
      wallet_transactions: wTxs,
      walletTransactions: wTxs,
      whatsapp_logs: waLogs,
      whatsappLogs: waLogs,
    },
  };
}

function getTodayFileDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function getLastTelegramBackupAt(): Promise<string | null> {
  if (globalForBackup.__mkLastTelegramBackupAt) {
    return new Date(globalForBackup.__mkLastTelegramBackupAt).toISOString();
  }
  try {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, LAST_BACKUP_SETTING_KEY))
      .limit(1);
    if (row?.value) {
      const ts = new Date(row.value).getTime();
      if (!isNaN(ts)) globalForBackup.__mkLastTelegramBackupAt = ts;
      return row.value;
    }
  } catch {}
  return null;
}

async function saveLastTelegramBackupAt(iso: string) {
  const ts = new Date(iso).getTime();
  if (!isNaN(ts)) globalForBackup.__mkLastTelegramBackupAt = ts;
  try {
    await db
      .insert(settings)
      .values({ key: LAST_BACKUP_SETTING_KEY, value: iso })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: iso, updatedAt: new Date() },
      });
  } catch (e) {
    console.warn("[backup] Failed to persist last_telegram_backup_at:", e instanceof Error ? e.message : e);
  }
}

export async function sendBackupDocumentToTelegram(opts?: {
  reason?: string;
}): Promise<{ ok: boolean; filename?: string; sentAt?: string; counts?: Record<string, number>; error?: string }> {
  const cfg = await resolveTelegramArchiveConfig();
  if (!cfg.token || !cfg.archiveChatId) {
    return {
      ok: false,
      error: "إعدادات بوت أو قناة الأرشيف في تيليجرام غير مضبوطة (TELEGRAM_BOT_TOKEN / TELEGRAM_ARCHIVE_CHAT_ID)",
    };
  }

  const payload = await buildFullBackupPayload();
  const dateStr = getTodayFileDate();
  const filename = `maestro-key-backup-${dateStr}.json`;
  const jsonBuffer = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  const sizeKb = (jsonBuffer.length / 1024).toFixed(1);
  const timeAden = new Date().toLocaleString("en-GB", { timeZone: "Asia/Aden", hour12: false });

  const caption = [
    `💾 نسخة احتياطية شاملة — Maestro Key`,
    `━━━━━━━━━━━━━━━━━━`,
    `📅 التاريخ: ${dateStr} (${timeAden})`,
    opts?.reason ? `📌 السبب: ${opts.reason}` : null,
    `👥 العملاء: ${payload.counts.customers}`,
    `🎬 المنصات: ${payload.counts.platforms} | 📦 الحسابات: ${payload.counts.accounts}`,
    `📄 الاشتراكات: ${payload.counts.rentals} | 💳 السندات: ${payload.counts.payments}`,
    `🗜️ الحجم: ${sizeKb} KB`,
  ]
    .filter(Boolean)
    .join("\n");

  const sent = await sendDocumentToTelegramArchive({
    buffer: jsonBuffer,
    filename,
    caption,
    mimeType: "application/json",
  });

  if (!sent.ok) {
    return { ok: false, error: sent.error || "فشل إرسال الملف إلى تيليجرام" };
  }

  const sentAt = new Date().toISOString();
  await saveLastTelegramBackupAt(sentAt);

  return {
    ok: true,
    filename,
    sentAt,
    counts: payload.counts,
  };
}

/**
 * يتم استدعاؤها بعد عمليات الإضافة والتعديل لتفحص في الذاكرة إن مرت 12 ساعة
 * وترسل النسخة الاحتياطية في الخلفية عبر Next.js after() دون إبطاء الاستجابة.
 */
export function triggerAutoTelegramBackupIfDue(reason = "نسخة احتياطية تلقائية كل 12 ساعة"): void {
  const now = Date.now();
  if (globalForBackup.__mkBackupInFlight) return;
  if (
    globalForBackup.__mkLastTelegramBackupAt &&
    now - globalForBackup.__mkLastTelegramBackupAt < TWELVE_HOURS_MS
  ) {
    return;
  }

  const runInBackground = async () => {
    if (globalForBackup.__mkBackupInFlight) return;
    globalForBackup.__mkBackupInFlight = true;
    try {
      const cfg = await resolveTelegramArchiveConfig();
      if (!cfg.token || !cfg.archiveChatId) return;

      const lastIso = await getLastTelegramBackupAt();
      const lastTs = lastIso ? new Date(lastIso).getTime() : 0;
      if (lastTs && Date.now() - lastTs < TWELVE_HOURS_MS) {
        globalForBackup.__mkLastTelegramBackupAt = lastTs;
        return;
      }

      // قفل زمني مؤقت لمنع التكرار قبل اكتمال الإرسال
      globalForBackup.__mkLastTelegramBackupAt = Date.now();
      const res = await sendBackupDocumentToTelegram({ reason });
      if (!res.ok) {
        // السماح بإعادة المحاولة في العملية التالية إذا فشل الإرسال
        globalForBackup.__mkLastTelegramBackupAt = lastTs || undefined;
        console.warn("[auto-telegram-backup] failed:", res.error);
      }
    } catch (e) {
      console.warn("[auto-telegram-backup] error:", e instanceof Error ? e.message : e);
    } finally {
      globalForBackup.__mkBackupInFlight = false;
    }
  };

  try {
    after(runInBackground);
  } catch {
    void runInBackground();
  }
}

/* ---------------- Safe Merge Restore (Zero Duplicates) ---------------- */

function toDateOrNull(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toDateOrNow(v: any): Date {
  return toDateOrNull(v) ?? new Date();
}

function pick(obj: any, camel: string, snake?: string) {
  if (obj[camel] !== undefined) return obj[camel];
  if (snake && obj[snake] !== undefined) return obj[snake];
  return undefined;
}

export async function restoreBackupPayload(raw: any): Promise<{
  inserted: Record<string, number>;
  skipped: Record<string, number>;
}> {
  if (!raw || typeof raw !== "object" || !raw.tables || typeof raw.tables !== "object") {
    throw new Error("صيغة ملف النسخة الاحتياطية غير صالحة (يجب أن يحتوي على كائن tables)");
  }
  const t = raw.tables;

  const inserted: Record<string, number> = {
    settings: 0,
    paymentMethods: 0,
    platforms: 0,
    users: 0,
    customers: 0,
    accounts: 0,
    profiles: 0,
    rentals: 0,
    payments: 0,
  };
  const skipped: Record<string, number> = { ...inserted };

  const [
    existingBanks,
    existingPlats,
    existingUsers,
    existingCusts,
    existingAccs,
    existingProfiles,
    existingRentals,
    existingPayments,
    existingSettings,
  ] = await Promise.all([
    db.select().from(paymentMethods),
    db.select().from(platforms),
    db.select().from(users),
    db.select().from(customers),
    db.select().from(accounts),
    db.select().from(profiles),
    db.select().from(rentals),
    db.select({ id: payments.id, rentalId: payments.rentalId, transactionRef: payments.transactionRef }).from(payments),
    db.select().from(settings),
  ]);

  // 1. Settings (merge by key)
  const existingSettingKeys = new Set(existingSettings.map((s) => s.key));
  for (const row of t.settings || []) {
    const key = String(row.key || "").trim();
    if (!key) continue;
    if (existingSettingKeys.has(key)) {
      skipped.settings++;
    } else {
      await db.insert(settings).values({ key, value: String(row.value ?? "") }).onConflictDoNothing();
      existingSettingKeys.add(key);
      inserted.settings++;
    }
  }

  // 2. Payment Methods (merge by name)
  const bankIdMap = new Map<number, number>();
  const bankByName = new Map(existingBanks.map((b) => [b.name.trim(), b.id]));
  for (const row of t.paymentMethods || t.payment_methods || []) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const oldId = Number(row.id);
    const existingId = bankByName.get(name);
    if (existingId) {
      if (oldId) bankIdMap.set(oldId, existingId);
      skipped.paymentMethods++;
    } else {
      const [ins] = await db
        .insert(paymentMethods)
        .values({
          name,
          isActive: pick(row, "isActive", "is_active") !== false,
          createdAt: toDateOrNow(pick(row, "createdAt", "created_at")),
        })
        .returning({ id: paymentMethods.id });
      bankByName.set(name, ins.id);
      if (oldId) bankIdMap.set(oldId, ins.id);
      inserted.paymentMethods++;
    }
  }

  // 3. Platforms (merge by name)
  const platIdMap = new Map<number, number>();
  const platByName = new Map(existingPlats.map((p) => [p.name.trim(), p.id]));
  for (const row of t.platforms || []) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const oldId = Number(row.id);
    const existingId = platByName.get(name);
    if (existingId) {
      if (oldId) platIdMap.set(oldId, existingId);
      skipped.platforms++;
    } else {
      const [ins] = await db
        .insert(platforms)
        .values({
          name,
          color: String(row.color || "#0f172a"),
          shortName: String(pick(row, "shortName", "short_name") || name.slice(0, 1) || "▶").slice(0, 10),
          imageUrl: pick(row, "imageUrl", "image_url") || null,
          deliveryMode: String(pick(row, "deliveryMode", "delivery_mode") || "INSTANT_INVENTORY"),
          requiresCustomerEmail: Boolean(pick(row, "requiresCustomerEmail", "requires_customer_email")),
          extraFieldLabel: pick(row, "extraFieldLabel", "extra_field_label") || null,
          isLifetime: Boolean(pick(row, "isLifetime", "is_lifetime")),
          isActive: pick(row, "isActive", "is_active") !== false,
          lowStockThreshold: Number(pick(row, "lowStockThreshold", "low_stock_threshold") ?? 3),
          createdAt: toDateOrNow(pick(row, "createdAt", "created_at")),
        })
        .returning({ id: platforms.id });
      platByName.set(name, ins.id);
      if (oldId) platIdMap.set(oldId, ins.id);
      inserted.platforms++;
    }
  }

  // 4. Users (merge by username)
  const userIdMap = new Map<number, number>();
  const userByUsername = new Map(existingUsers.map((u) => [u.username.toLowerCase(), u.id]));
  const fallbackAdminId = existingUsers.find((u) => u.role === "ADMIN")?.id ?? existingUsers[0]?.id ?? 1;
  for (const row of t.users || []) {
    const username = String(row.username || "").trim().toLowerCase();
    if (!username) continue;
    const oldId = Number(row.id);
    const existingId = userByUsername.get(username);
    if (existingId) {
      if (oldId) userIdMap.set(oldId, existingId);
      skipped.users++;
    } else {
      const pwHash = String(pick(row, "passwordHash", "password_hash") || "");
      if (!pwHash) {
        skipped.users++;
        continue;
      }
      const [ins] = await db
        .insert(users)
        .values({
          username,
          passwordHash: pwHash,
          displayName: String(pick(row, "displayName", "display_name") || username),
          role: String(row.role || "USER"),
          walletBalance: String(pick(row, "walletBalance", "wallet_balance") ?? "0.00"),
          isActive: pick(row, "isActive", "is_active") !== false,
          email: row.email || null,
          permissions: row.permissions || null,
          createdAt: toDateOrNow(pick(row, "createdAt", "created_at")),
        })
        .returning({ id: users.id });
      userByUsername.set(username, ins.id);
      if (oldId) userIdMap.set(oldId, ins.id);
      inserted.users++;
    }
  }

  // 5. Customers (merge by phone)
  const custIdMap = new Map<number, number>();
  const custByPhone = new Map(existingCusts.map((c) => [c.phone.trim(), c.id]));
  for (const row of t.customers || []) {
    const phone = String(row.phone || "").trim();
    const name = String(row.name || "").trim();
    if (!phone || !name) continue;
    const oldId = Number(row.id);
    const existingId = custByPhone.get(phone);
    if (existingId) {
      if (oldId) custIdMap.set(oldId, existingId);
      skipped.customers++;
    } else {
      const [ins] = await db
        .insert(customers)
        .values({
          name,
          phone,
          notes: row.notes || null,
          createdAt: toDateOrNow(pick(row, "createdAt", "created_at")),
        })
        .returning({ id: customers.id });
      custByPhone.set(phone, ins.id);
      if (oldId) custIdMap.set(oldId, ins.id);
      inserted.customers++;
    }
  }

  // 6. Accounts (merge using composite fingerprint)
  const accKey = (pid: number, email: string | null, link: string | null, kind: string, createdIso: string) =>
    `${pid}|${email || ""}|${link || ""}|${kind}|${createdIso}`;
  const accByKey = new Map<string, number>();
  for (const a of existingAccs) {
    accByKey.set(accKey(a.platformId, a.email, a.inviteLink, a.deliveryKind, new Date(a.createdAt).toISOString()), a.id);
  }
  const accIdMap = new Map<number, number>();
  for (const row of t.accounts || []) {
    const oldId = Number(row.id);
    const oldPid = Number(pick(row, "platformId", "platform_id"));
    const pid = platIdMap.get(oldPid) || (existingPlats.some((p) => p.id === oldPid) ? oldPid : 0);
    if (!pid) {
      skipped.accounts++;
      continue;
    }
    const email = row.email ? String(row.email).trim() : null;
    const inviteLink = pick(row, "inviteLink", "invite_link") || null;
    const deliveryKind = String(pick(row, "deliveryKind", "delivery_kind") || "CREDENTIALS");
    const createdAt = toDateOrNow(pick(row, "createdAt", "created_at"));
    const key = accKey(pid, email, inviteLink, deliveryKind, createdAt.toISOString());

    // Also match email+platform if email is unique enough
    const existingByFingerprint =
      accByKey.get(key) ??
      (email
        ? existingAccs.find(
            (a) => a.platformId === pid && a.email === email && a.deliveryKind === deliveryKind && a.isDeleted === Boolean(pick(row, "isDeleted", "is_deleted"))
          )?.id
        : undefined);

    if (existingByFingerprint) {
      if (oldId) accIdMap.set(oldId, existingByFingerprint);
      skipped.accounts++;
    } else {
      const [ins] = await db
        .insert(accounts)
        .values({
          platformId: pid,
          type: String(row.type || "FULL"),
          maxProfiles: Number(pick(row, "maxProfiles", "max_profiles") ?? 1),
          deliveryKind,
          email,
          passwordEncrypted: pick(row, "passwordEncrypted", "password_encrypted") || null,
          inviteLink,
          licenseKeyEncrypted: pick(row, "licenseKeyEncrypted", "license_key_encrypted") || null,
          maxUses: pick(row, "maxUses", "max_uses") ?? null,
          usedCount: Number(pick(row, "usedCount", "used_count") ?? 0),
          pin: row.pin || null,
          expiryDate: toDateOrNull(pick(row, "expiryDate", "expiry_date")),
          status: String(row.status || "AVAILABLE"),
          notes: row.notes || null,
          salePrice: pick(row, "salePrice", "sale_price") ?? null,
          isDeleted: Boolean(pick(row, "isDeleted", "is_deleted")),
          deletedAt: toDateOrNull(pick(row, "deletedAt", "deleted_at")),
          deletedReason: pick(row, "deletedReason", "deleted_reason") || null,
          createdAt,
          updatedAt: toDateOrNow(pick(row, "updatedAt", "updated_at")),
        })
        .returning({ id: accounts.id });
      accByKey.set(key, ins.id);
      if (oldId) accIdMap.set(oldId, ins.id);
      inserted.accounts++;
    }
  }

  // 7. Profiles (merge on (accountId, profileNo))
  const profKey = (aid: number, no: number) => `${aid}:${no}`;
  const profByKey = new Map(existingProfiles.map((p) => [profKey(p.accountId, p.profileNo), p.id]));
  const profIdMap = new Map<number, number>();
  for (const row of t.profiles || []) {
    const oldId = Number(row.id);
    const oldAid = Number(pick(row, "accountId", "account_id"));
    const aid = accIdMap.get(oldAid);
    const pNo = Number(pick(row, "profileNo", "profile_no"));
    if (!aid || !pNo) {
      skipped.profiles++;
      continue;
    }
    const existingId = profByKey.get(profKey(aid, pNo));
    if (existingId) {
      if (oldId) profIdMap.set(oldId, existingId);
      skipped.profiles++;
    } else {
      const oldSoldBy = pick(row, "soldBy", "sold_by");
      const [ins] = await db
        .insert(profiles)
        .values({
          accountId: aid,
          profileNo: pNo,
          profileName: pick(row, "profileName", "profile_name") || null,
          pin: row.pin || null,
          isOccupied: Boolean(pick(row, "isOccupied", "is_occupied")),
          currentRentalId: null,
          status: String(row.status || "AVAILABLE"),
          soldAt: toDateOrNull(pick(row, "soldAt", "sold_at")),
          soldBy: oldSoldBy ? userIdMap.get(Number(oldSoldBy)) ?? null : null,
          createdAt: toDateOrNow(pick(row, "createdAt", "created_at")),
        })
        .returning({ id: profiles.id });
      profByKey.set(profKey(aid, pNo), ins.id);
      if (oldId) profIdMap.set(oldId, ins.id);
      inserted.profiles++;
    }
  }

  // 8. Rentals (merge using customerId + platformId + startDate + createdAt signature)
  const rentalSig = (cid: number, pid: number, startIso: string, createdIso: string) =>
    `${cid}|${pid}|${startIso}|${createdIso}`;
  const rentalBySig = new Map<string, number>();
  for (const r of existingRentals) {
    rentalBySig.set(
      rentalSig(r.customerId, r.platformId, new Date(r.startDate).toISOString(), new Date(r.createdAt).toISOString()),
      r.id
    );
  }
  const rentalIdMap = new Map<number, number>();
  for (const row of t.rentals || []) {
    const oldId = Number(row.id);
    const oldCid = Number(pick(row, "customerId", "customer_id"));
    const oldPid = Number(pick(row, "platformId", "platform_id"));
    const cid = custIdMap.get(oldCid);
    const pid = platIdMap.get(oldPid);
    if (!cid || !pid) {
      skipped.rentals++;
      continue;
    }
    const startDate = toDateOrNow(pick(row, "startDate", "start_date"));
    const endDate = toDateOrNow(pick(row, "endDate", "end_date"));
    const createdAt = toDateOrNow(pick(row, "createdAt", "created_at"));
    const sig = rentalSig(cid, pid, startDate.toISOString(), createdAt.toISOString());
    const existingId = rentalBySig.get(sig);
    if (existingId) {
      if (oldId) rentalIdMap.set(oldId, existingId);
      skipped.rentals++;
    } else {
      const oldAid = pick(row, "accountId", "account_id");
      const oldProfId = pick(row, "profileId", "profile_id");
      const oldCreatedBy = Number(pick(row, "createdBy", "created_by"));
      const oldActBy = pick(row, "activatedBy", "activated_by");

      const [ins] = await db
        .insert(rentals)
        .values({
          accountId: oldAid ? accIdMap.get(Number(oldAid)) ?? null : null,
          profileId: oldProfId ? profIdMap.get(Number(oldProfId)) ?? null : null,
          customerId: cid,
          platformId: pid,
          createdBy: userIdMap.get(oldCreatedBy) ?? fallbackAdminId,
          rentalType: String(pick(row, "rentalType", "rental_type") || "NEW"),
          startDate,
          endDate,
          durationDays: Number(pick(row, "durationDays", "duration_days") ?? 30),
          isLifetime: Boolean(pick(row, "isLifetime", "is_lifetime")),
          status: String(row.status || "ACTIVE"),
          passwordUsedEncrypted: pick(row, "passwordUsedEncrypted", "password_used_encrypted") || null,
          whatsappAlertSent: Boolean(pick(row, "whatsappAlertSent", "whatsapp_alert_sent")),
          whatsappAlertSentAt: toDateOrNull(pick(row, "whatsappAlertSentAt", "whatsapp_alert_sent_at")),
          customerEmail: pick(row, "customerEmail", "customer_email") || null,
          customerExtra: pick(row, "customerExtra", "customer_extra") || null,
          activationStatus: String(pick(row, "activationStatus", "activation_status") || "NOT_REQUIRED"),
          activatedEmail: pick(row, "activatedEmail", "activated_email") || null,
          activatedPassword: pick(row, "activatedPassword", "activated_password") || null,
          activatedLink: pick(row, "activatedLink", "activated_link") || null,
          activatedPin: pick(row, "activatedPin", "activated_pin") || null,
          activatedNote: pick(row, "activatedNote", "activated_note") || null,
          activatedAt: toDateOrNull(pick(row, "activatedAt", "activated_at")),
          activatedBy: oldActBy ? userIdMap.get(Number(oldActBy)) ?? null : null,
          deliverySource: String(pick(row, "deliverySource", "delivery_source") || "AUTO"),
          manualEmail: pick(row, "manualEmail", "manual_email") || null,
          manualPasswordEncrypted: pick(row, "manualPasswordEncrypted", "manual_password_encrypted") || null,
          manualLink: pick(row, "manualLink", "manual_link") || null,
          manualCodeEncrypted: pick(row, "manualCodeEncrypted", "manual_code_encrypted") || null,
          manualNote: pick(row, "manualNote", "manual_note") || null,
          refundedAt: toDateOrNull(pick(row, "refundedAt", "refunded_at")),
          refundReason: pick(row, "refundReason", "refund_reason") || null,
          createdAt,
          updatedAt: toDateOrNow(pick(row, "updatedAt", "updated_at")),
        })
        .returning({ id: rentals.id });

      // Update profile currentRentalId if occupied
      if (oldProfId && profIdMap.get(Number(oldProfId))) {
        const mappedProfId = profIdMap.get(Number(oldProfId))!;
        if (String(row.status) === "ACTIVE" || String(row.status) === "ENDED") {
          await db.update(profiles).set({ currentRentalId: ins.id }).where(and(eq(profiles.id, mappedProfId), sql`${profiles.currentRentalId} IS NULL`));
        }
      }

      rentalBySig.set(sig, ins.id);
      if (oldId) rentalIdMap.set(oldId, ins.id);
      inserted.rentals++;
    }
  }

  // 9. Payments (merge on (rentalId, transactionRef))
  const payKey = (rid: number, ref: string) => `${rid}|${ref}`;
  const existingPayKeys = new Set(existingPayments.map((p) => payKey(p.rentalId, p.transactionRef)));
  for (const row of t.payments || []) {
    const oldRid = Number(pick(row, "rentalId", "rental_id"));
    const rid = rentalIdMap.get(oldRid);
    const ref = String(pick(row, "transactionRef", "transaction_ref") || "").trim();
    if (!rid || !ref) {
      skipped.payments++;
      continue;
    }
    const key = payKey(rid, ref);
    if (existingPayKeys.has(key)) {
      skipped.payments++;
    } else {
      const oldMid = pick(row, "paymentMethodId", "payment_method_id");
      const oldRevBy = pick(row, "reviewedBy", "reviewed_by");
      const oldCreatedBy = pick(row, "createdBy", "created_by");
      await db.insert(payments).values({
        rentalId: rid,
        paymentMethodId: oldMid ? bankIdMap.get(Number(oldMid)) ?? null : null,
        transactionRef: ref,
        amount: Number(row.amount ?? 0),
        receiptImageData: sanitizeReceiptForBackup(pick(row, "receiptImageData", "receipt_image_data")),
        receiptHash: pick(row, "receiptHash", "receipt_hash") || null,
        status: String(row.status || "PENDING"),
        reviewedBy: oldRevBy ? userIdMap.get(Number(oldRevBy)) ?? null : null,
        reviewedAt: toDateOrNull(pick(row, "reviewedAt", "reviewed_at")),
        rejectionReason: pick(row, "rejectionReason", "rejection_reason") || null,
        isExtension: Boolean(pick(row, "isExtension", "is_extension")),
        durationDays: Number(pick(row, "durationDays", "duration_days") ?? 0),
        previousEndDate: toDateOrNull(pick(row, "previousEndDate", "previous_end_date")),
        previousRentalStatus: pick(row, "previousRentalStatus", "previous_rental_status") || null,
        createdBy: oldCreatedBy ? userIdMap.get(Number(oldCreatedBy)) ?? null : null,
        createdAt: toDateOrNow(pick(row, "createdAt", "created_at")),
      });
      existingPayKeys.add(key);
      inserted.payments++;
    }
  }

  // Sync PostgreSQL serial sequences cleanly
  try {
    const tablesToReset = [
      "users",
      "platforms",
      "payment_methods",
      "customers",
      "accounts",
      "profiles",
      "rentals",
      "payments",
      "settings",
    ];
    for (const tbl of tablesToReset) {
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM "${tbl}"), 1), true)`
      );
    }
  } catch (e) {
    console.warn("[restore] sequence sync warning:", e instanceof Error ? e.message : e);
  }

  return { inserted, skipped };
}
