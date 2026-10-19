import nodemailer from "nodemailer";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { decryptText } from "@/lib/crypto";

export type MailErrorCode =
  | "SMTP_NOT_CONFIGURED"
  | "SMTP_SECRET_UNREADABLE"
  | "SMTP_AUTH_FAILED"
  | "SMTP_UNREACHABLE"
  | "SMTP_SEND_FAILED";

export class MailDeliveryError extends Error {
  constructor(public readonly code: MailErrorCode, message: string) {
    super(message);
    this.name = "MailDeliveryError";
  }
}

const MAIL_KEYS = ["smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_from", "smtp_pass"];

/** Environment secrets take priority; encrypted saved settings are a persistent fallback. */
export async function getMailConfig() {
  const rows = await db.select().from(settings).where(inArray(settings.key, MAIL_KEYS));
  const saved = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const host = (process.env.SMTP_HOST || saved.smtp_host || "").trim();
  const user = (process.env.SMTP_USER || saved.smtp_user || "").trim();
  let pass = process.env.SMTP_PASS || "";
  if (!pass && saved.smtp_pass) {
    pass = decryptText(saved.smtp_pass);
    if (!pass) {
      throw new MailDeliveryError("SMTP_SECRET_UNREADABLE", "تعذر فتح بيانات البريد المحفوظة. أعد حفظ كلمة مرور التطبيقات من إعدادات البريد.");
    }
  }
  if (!host || !user || !pass) {
    throw new MailDeliveryError("SMTP_NOT_CONFIGURED", "إرسال البريد غير مضبوط على هذا الخادم. احفظ إعدادات SMTP ثم أعد المحاولة.");
  }
  // Google displays app passwords with spaces; those spaces are not part of the password.
  if (host.toLowerCase() === "smtp.gmail.com") pass = pass.replace(/\s/g, "");
  const port = Number(process.env.SMTP_PORT || saved.smtp_port || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailDeliveryError("SMTP_NOT_CONFIGURED", "منفذ البريد غير صحيح في إعدادات SMTP.");
  }
  const secure = port === 465 || (process.env.SMTP_SECURE || saved.smtp_secure) === "true";
  return {
    host,
    port,
    secure,
    user,
    pass,
    from: (process.env.SMTP_FROM || saved.smtp_from || user).trim(),
  };
}

function smtpError(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) return error;
  const value = error as { code?: string; responseCode?: number };
  // Never return raw SMTP responses, transport options, or credentials to the browser.
  if (value?.code === "EAUTH" || value?.responseCode === 535 || value?.responseCode === 534) {
    return new MailDeliveryError("SMTP_AUTH_FAILED", "رفض جيميل تسجيل الدخول لبريد الإرسال. تأكد من أن كلمة مرور التطبيقات ما زالت فعالة.");
  }
  if (["ETIMEDOUT", "ECONNECTION", "ECONNREFUSED", "ESOCKET", "EDNS"].includes(value?.code || "")) {
    return new MailDeliveryError("SMTP_UNREACHABLE", "تعذر الاتصال بخادم البريد حالياً. حاول مرة أخرى بعد قليل.");
  }
  return new MailDeliveryError("SMTP_SEND_FAILED", "تعذر إرسال الكود حالياً. أعد المحاولة بعد قليل.");
}

export async function sendLoginCode(email: string, code: string): Promise<void> {
  const config = await getMailConfig();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 12_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  });
  try {
    const result = await transport.sendMail({
      from: { name: "Maestro Key — مايسترو كي", address: config.from },
      to: email,
      subject: "كود التحقق — مايسترو كي",
      text: `كود التحقق الخاص بك: ${code}\nصالح لمدة 10 دقائق وللاستخدام مرة واحدة فقط.\nإذا لم تطلب هذا الكود، تجاهل الرسالة.\nمتجر مايسترو كي`,
      html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#080e1c;color:#e8eef8;border-radius:20px"><h1 style="color:#74b4ff;font-size:24px">Maestro Key</h1><h2>كود التحقق الخاص بك</h2><p>استخدم هذا الكود لإكمال التحقق وتعيين كلمة مرورك:</p><div dir="ltr" style="font-size:34px;letter-spacing:10px;font-weight:bold;text-align:center;padding:20px;background:#111e36;border-radius:12px">${code}</div><p style="color:#abb9d1">صالح لمدة 10 دقائق وللاستخدام مرة واحدة فقط. لا تشاركه مع أي شخص.</p><p style="font-size:12px;color:#8190a8">إذا لم تطلب هذا الكود، تجاهل الرسالة.</p></div>`,
    });
    if (!result.accepted.length) throw new MailDeliveryError("SMTP_SEND_FAILED", "خادم البريد لم يقبل إرسال الكود. حاول لاحقاً.");
  } catch (error) {
    throw smtpError(error);
  } finally {
    transport.close();
  }
}
