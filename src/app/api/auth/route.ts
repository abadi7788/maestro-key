import crypto from "crypto";
import { db } from "@/db";
import { users, emailCodes, settings } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { Resend } from "resend";
import { decryptText, signSession } from "@/lib/crypto";
import { getCurrentUser, audit } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";

const ADMIN_EMAIL = "almaystrwbady@gmail.com";

function sessionResponse(user: { id: number; username: string; displayName: string; role: string }) {
  const token = signSession({ userId: user.id, role: user.role, username: user.username });
  return new Response(JSON.stringify({ user }), {
    headers: { "content-type": "application/json", "Set-Cookie": `maestro_session=${token}; Path=/; HttpOnly; Max-Age=${12 * 3600}; SameSite=Lax` },
  });
}

// Option B: بيانات بريد الجيميل مثبتة داخل الكود حتى لا تُفقد عند تحديث .env
const FALLBACK_SMTP = {
  host: "smtp.gmail.com",
  port: 587,
  user: "almaystrwbady@gmail.com",
  pass: "xoowksnlfvinyful",
  from: "almaystrwbady@gmail.com",
};

/**
 * إرسال كود الدخول (OTP).
 * الأولوية: Resend (الإنتاج — لا يُحظر مثل Gmail) ثم SMTP/Gmail (التطوير المحلي).
 */
async function sendLoginCode(email: string, code: string) {
  const body = `كود الدخول الخاص بك هو: ${code}\nصالح لمدة 10 دقائق.\nمتجر مايسترو كي — Maestro Key`;

  // 1) Resend — الطريقة الأساسية في الإنتاج (Vercel)
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      const from = process.env.RESEND_FROM || "Maestro Key <onboarding@resend.dev>";
      const { error } = await resend.emails.send({
        from,
        to: email,
        subject: "كود دخول مايسترو كي 🔑",
        text: body,
      });
      if (error) {
        console.error("Resend send error:", error);
        return false;
      }
      return true;
    } catch (e: any) {
      console.error("Resend exception:", e?.message || e);
      return false;
    }
  }

  // 2) SMTP/Gmail — احتياطي لبيئة التطوير حيث لا يكون RESEND_API_KEY مضبوطاً
  const rows = await db.select().from(settings);
  const map: Record<string, string> = {};
  rows.forEach((r) => { map[r.key] = r.value; });
  const host = process.env.SMTP_HOST || map.smtp_host || FALLBACK_SMTP.host;
  const user = process.env.SMTP_USER || map.smtp_user || FALLBACK_SMTP.user;
  const pass = process.env.SMTP_PASS || (map.smtp_pass ? decryptText(map.smtp_pass) : "") || FALLBACK_SMTP.pass;
  if (!host || !user || !pass) return false;
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || map.smtp_port || FALLBACK_SMTP.port),
    secure: (process.env.SMTP_SECURE || map.smtp_secure) === "true",
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || map.smtp_from || FALLBACK_SMTP.from || user,
    to: email,
    subject: "كود دخول مايسترو كي",
    text: body,
  });
  return true;
}

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const user = await getCurrentUser();
  if (!user) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const body = await req.json().catch(() => ({}));
  if (body.action === "logout") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "Set-Cookie": "maestro_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax" },
    });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (body.action === "send-code") {
    if (email !== ADMIN_EMAIL) return Response.json({ error: "هذا البريد غير مصرح له بدخول الإدارة" }, { status: 403 });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await db.insert(emailCodes).values({ email, codeHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    const sent = await sendLoginCode(email, code).catch((e: any) => { console.error("sendLoginCode failed:", e?.message || e); return false; });
    if (!sent) return Response.json({ error: "تعذر إرسال الكود إلى البريد. تأكد من إعداد RESEND_API_KEY ثم أعد المحاولة." }, { status: 503 });
    return Response.json({ ok: true, message: "تم إرسال الكود إلى بريدك" });
  }
  if (body.action === "set-password") {
    if (email !== ADMIN_EMAIL) return Response.json({ error: "هذا البريد غير مصرح له" }, { status: 403 });
    const code = String(body.code || "").trim();
    const newPassword = String(body.password || "");
    if (newPassword.length < 6) return Response.json({ error: "كلمة المرور 6 أحرف على الأقل" }, { status: 400 });
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const [row] = await db.select().from(emailCodes).where(and(eq(emailCodes.email, email), eq(emailCodes.codeHash, codeHash), eq(emailCodes.used, false))).orderBy(desc(emailCodes.id)).limit(1);
    if (!row || new Date(row.expiresAt) < new Date()) return Response.json({ error: "الكود غير صحيح أو منتهي" }, { status: 401 });
    await db.update(emailCodes).set({ used: true }).where(eq(emailCodes.id, row.id));
    let [adminUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!adminUser) {
      const admins = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
      adminUser = admins[0];
    }
    if (!adminUser) return Response.json({ error: "لا يوجد حساب مدير" }, { status: 404 });
    await db.update(users).set({ email, passwordHash: await bcrypt.hash(newPassword, 10), failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, adminUser.id));
    await audit(adminUser, "PASSWORD_SET", "users", adminUser.id, "تعيين كلمة مرور المدير بعد كود البريد");
    return sessionResponse({ id: adminUser.id, username: adminUser.username, displayName: adminUser.displayName, role: adminUser.role });
  }

  const username = String(body.username || body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const [user] = username.includes("@")
    ? await db.select().from(users).where(eq(users.email, username)).limit(1)
    : await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user || !user.isActive) return Response.json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }, { status: 401 });

  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return Response.json({ error: "الحساب مقفل مؤقتاً بسبب محاولات دخول فاشلة. حاول بعد قليل أو تواصل مع المدير." }, { status: 423 });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedAttempts + 1;
    await db.update(users).set({ failedAttempts: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null }).where(eq(users.id, user.id));
    await audit(user, "LOGIN_FAILED", "users", user.id, `محاولة دخول فاشلة رقم ${attempts}`);
    return Response.json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }, { status: 401 });
  }
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit(user, "LOGIN", "users", user.id, "تسجيل دخول ناجح");
  const token = signSession({ userId: user.id, role: user.role, username: user.username });
  return new Response(JSON.stringify({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } }), {
    headers: { "content-type": "application/json", "Set-Cookie": `maestro_session=${token}; Path=/; HttpOnly; Max-Age=${12 * 3600}; SameSite=Lax` },
  });
}
