import crypto from "crypto";
import { db } from "@/db";
import { users, emailCodes } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { signSession } from "@/lib/crypto";
import { getCurrentUser, audit } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { MailDeliveryError, sendLoginCode } from "@/lib/mail";

const ADMIN_EMAIL = "almaystrwbady@gmail.com";

function sessionResponse(user: { id: number; username: string; displayName: string; role: string }) {
  const token = signSession({ userId: user.id, role: user.role, username: user.username });
  return new Response(JSON.stringify({ user }), {
    headers: { "content-type": "application/json", "Set-Cookie": `maestro_session=${token}; Path=/; HttpOnly; Max-Age=${12 * 3600}; SameSite=Lax` },
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const [recent] = await db.select().from(emailCodes).where(eq(emailCodes.email, email)).orderBy(desc(emailCodes.id)).limit(1);
    if (recent && new Date(recent.expiresAt).getTime() > Date.now() && Date.now() - new Date(recent.createdAt).getTime() < 60_000) {
      return Response.json({ error: "انتظر دقيقة قبل طلب كود آخر، وراجع بريدك والرسائل غير المرغوب فيها." }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    // A code is unusable until the SMTP server accepts the message.
    const [pending] = await db.insert(emailCodes).values({ email, codeHash, used: true, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }).returning({ id: emailCodes.id });
    try {
      await sendLoginCode(email, code);
      await db.transaction(async (tx) => {
        await tx.update(emailCodes).set({ used: true }).where(eq(emailCodes.email, email));
        await tx.update(emailCodes).set({ used: false }).where(eq(emailCodes.id, pending.id));
      });
      return Response.json({ ok: true, message: "تم إرسال الكود إلى بريدك. صلاحيته 10 دقائق؛ راجع الوارد والرسائل غير المرغوب فيها." }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await db.update(emailCodes).set({ used: true, expiresAt: new Date() }).where(eq(emailCodes.id, pending.id));
      const failure = error instanceof MailDeliveryError ? error : new MailDeliveryError("SMTP_SEND_FAILED", "تعذر إرسال الكود حالياً. حاول مرة أخرى بعد قليل.");
      console.error("Login email could not be sent:", failure.code);
      return Response.json({ error: failure.message, code: failure.code }, { status: 503 });
    }
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
    if (!adminUser) [adminUser] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
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
