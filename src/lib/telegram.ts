import { db } from "@/db";
import { customers, paymentMethods, payments, platforms, rentals, settings } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  deleteReceiptFromStorage,
  downloadReceiptFromStorage,
  isStorageRef,
  parseDataUrlImage,
} from "./supabase-storage";

export const TELEGRAM_ARCHIVED_MARKER = "tg://archived";

function getTelegramConfig() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const archiveChatId = (process.env.TELEGRAM_ARCHIVE_CHAT_ID || "").trim();
  const adminChatId = (process.env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
  return { token, archiveChatId, adminChatId };
}

export async function resolveTelegramArchiveConfig(): Promise<{ token: string; archiveChatId: string }> {
  const envCfg = getTelegramConfig();
  if (envCfg.token && envCfg.archiveChatId) {
    return { token: envCfg.token, archiveChatId: envCfg.archiveChatId };
  }
  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ["telegram_bot_token", "telegram_archive_chat_id"]));
    const map = new Map(rows.map((r) => [r.key, r.value.trim()]));
    return {
      token: envCfg.token || map.get("telegram_bot_token") || "",
      archiveChatId: envCfg.archiveChatId || map.get("telegram_archive_chat_id") || "",
    };
  } catch {
    return { token: envCfg.token, archiveChatId: envCfg.archiveChatId };
  }
}

export function isTelegramArchiveConfigured(): boolean {
  const { token, archiveChatId } = getTelegramConfig();
  return Boolean(token && archiveChatId);
}

export async function sendPhotoToTelegramArchive(opts: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  caption: string;
}): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const { token, archiveChatId } = await resolveTelegramArchiveConfig();
  if (!token || !archiveChatId) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_ARCHIVE_CHAT_ID not configured" };
  }

  const form = new FormData();
  form.append("chat_id", archiveChatId);
  form.append("caption", opts.caption.slice(0, 1024));
  const blob = new Blob([new Uint8Array(opts.buffer)], { type: opts.mimeType || "image/jpeg" });
  form.append("photo", blob, opts.filename);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json?.ok) {
    return { ok: false, error: json?.description || `HTTP ${res.status}` };
  }
  return { ok: true, messageId: json?.result?.message_id };
}

export async function sendDocumentToTelegramArchive(opts: {
  buffer: Buffer;
  filename: string;
  caption?: string;
  mimeType?: string;
}): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const { token, archiveChatId } = await resolveTelegramArchiveConfig();
  if (!token || !archiveChatId) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_ARCHIVE_CHAT_ID not configured" };
  }

  const form = new FormData();
  form.append("chat_id", archiveChatId);
  if (opts.caption) form.append("caption", opts.caption.slice(0, 1024));
  const blob = new Blob([new Uint8Array(opts.buffer)], { type: opts.mimeType || "application/gzip" });
  form.append("document", blob, opts.filename);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json?.ok) {
    return { ok: false, error: json?.description || `HTTP ${res.status}` };
  }
  return { ok: true, messageId: json?.result?.message_id };
}

export async function sendAdminTelegramMessage(text: string): Promise<boolean> {
  const { token, adminChatId } = getTelegramConfig();
  if (!token || !adminChatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: adminChatId, text }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => ({} as any));
    return Boolean(res.ok && json?.ok);
  } catch {
    return false;
  }
}

/**
 * عند اعتماد/تأكيد الطلب:
 * 1) جلب صورة السند من Supabase Storage (أو من Base64 القديم)
 * 2) إرسال الصورة مع تفاصيل الطلب إلى قناة تيليجرام للأرشفة
 * 3) حذف الصورة فوراً من Supabase Storage وتفريغها من قاعدة البيانات (tg://archived)
 *    مع الإبقاء على receipt_hash لمنع تكرار نفس السند مستقبلاً.
 */
export async function archivePaymentReceiptToTelegram(
  paymentId: number,
  confirmedBy?: string
): Promise<{ ok: boolean; archived: boolean; skipped?: boolean; error?: string }> {
  const [pay] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!pay) return { ok: false, archived: false, skipped: true, error: "Payment not found" };

  const ref = pay.receiptImageData;
  if (!ref || ref === TELEGRAM_ARCHIVED_MARKER) {
    return { ok: true, archived: false, skipped: true };
  }

  if (!isTelegramArchiveConfigured()) {
    console.warn("[Telegram Archive] TELEGRAM_BOT_TOKEN or TELEGRAM_ARCHIVE_CHAT_ID not configured — skipping archive.");
    return { ok: false, archived: false, skipped: true, error: "Telegram not configured" };
  }

  let imgData: { buffer: Buffer; mimeType: string } | null = null;
  const fromStorage = isStorageRef(ref);
  if (fromStorage) {
    const dl = await downloadReceiptFromStorage(ref);
    if (dl) imgData = { buffer: dl.buffer, mimeType: dl.mimeType };
  } else {
    const parsed = parseDataUrlImage(ref);
    if (parsed) imgData = { buffer: parsed.buffer, mimeType: parsed.mimeType };
  }

  if (!imgData) {
    return { ok: false, archived: false, error: "Receipt image data missing or unreadable" };
  }

  const [rental] = await db.select().from(rentals).where(eq(rentals.id, pay.rentalId)).limit(1);
  const [cust] = rental
    ? await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1)
    : [];
  const [plat] = rental
    ? await db.select().from(platforms).where(eq(platforms.id, rental.platformId)).limit(1)
    : [];
  const [bank] = pay.paymentMethodId
    ? await db.select().from(paymentMethods).where(eq(paymentMethods.id, pay.paymentMethodId)).limit(1)
    : [];

  const ext = imgData.mimeType === "image/png" ? "png" : imgData.mimeType === "image/webp" ? "webp" : "jpg";
  const dateStr = new Date().toLocaleString("en-GB", { timeZone: "Asia/Aden", hour12: false });

  const caption = [
    `🧾 أرشفة سند دفع معتمد`,
    `━━━━━━━━━━━━━━━━━━`,
    `📌 رقم الطلب: #${rental?.id ?? pay.rentalId} (سند #${pay.id})`,
    `👤 العميل: ${cust?.name || "غير محدد"}`,
    `📱 الواتساب: ${cust?.phone || "—"}`,
    `🎬 المنصة: ${plat?.name || "—"}`,
    `💰 المبلغ: ${Number(pay.amount || 0).toLocaleString("en-US")} ر.ي`,
    `🏦 البنك: ${bank?.name || "—"}`,
    `🔢 رقم العملية: ${pay.transactionRef || "—"}`,
    confirmedBy ? `✅ اعتمد بواسطة: ${confirmedBy}` : null,
    `🕒 وقت الأرشفة: ${dateStr}`,
  ]
    .filter(Boolean)
    .join("\n");

  const sent = await sendPhotoToTelegramArchive({
    buffer: imgData.buffer,
    mimeType: imgData.mimeType,
    filename: `receipt-order-${rental?.id ?? pay.rentalId}-pay-${pay.id}.${ext}`,
    caption,
  });

  if (!sent.ok) {
    console.error(`[Telegram Archive] Failed to send receipt for payment #${pay.id}:`, sent.error);
    return { ok: false, archived: false, error: sent.error };
  }

  // حذف الصورة فوراً من Supabase Storage بعد نجاح الإرسال لتيليجرام
  if (fromStorage) {
    await deleteReceiptFromStorage(ref);
  }

  // تحديث حقل السند في القاعدة بعلامة الأرشفة لإبقاء المساحة فارغة ونظيفة (مع إبقاء receiptHash لكشف التكرار)
  await db
    .update(payments)
    .set({ receiptImageData: TELEGRAM_ARCHIVED_MARKER })
    .where(eq(payments.id, pay.id));

  return { ok: true, archived: true };
}
