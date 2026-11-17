import { db } from "@/db";
import { users, platforms, paymentMethods, settings } from "@/db/schema";
import { ensureSchema } from "./schema-check";
import bcrypt from "bcryptjs";

const DEFAULT_SETTINGS = [
  {
    key: "whatsapp_expiry_template",
    value:
      "مرحباً {{name}} 👋\nتنبيه من متجر مايسترو كي 🔑\nاشتراكك في {{platform}} سينتهي بتاريخ {{end_date}} (بعد {{days}} يوم).\nللتجديد بدون انقطاع، حوّل مبلغ التجديد وأرسل السند هنا وسنمدّد اشتراكك فوراً.\nشكراً لثقتك بنا.",
  },
  {
    key: "whatsapp_expired_template",
    value:
      "مرحباً {{name}} ⏳\nتنبيه من متجر مايسترو كي 🔑\nلقد انتهت صلاحية اشتراكك في {{platform}} بتاريخ {{end_date}}.\nلإعادة التفعيل أو التجديد الفوري بنفس الخدمة تواصل معنا الآن وسنخدّمك مباشرة.",
  },
  {
    key: "whatsapp_sale_template",
    value:
      "مرحباً {{name}} 🎉\nتم تفعيل اشتراك {{platform}} بنجاح من متجر مايسترو كي 🔑\n📧 الإيميل: {{email}}\n🔑 كلمة المرور: {{password}}\n👤 البروفايل/PIN: {{profile}}\n⏳ صالح حتى: {{end_date}}\nمشاهدة سعيدة! لا تشارك البيانات مع أحد.",
  },
  {
    key: "whatsapp_renewal_template",
    value:
      "مرحباً {{name}} ✅\nتم تجديد اشتراك {{platform}} بنجاح حتى {{end_date}}.\nنفس بيانات الدخول السابقة تعمل بدون تغيير.\nمتجر مايسترو كي 🔑",
  },
  {
    key: "whatsapp_activation_template",
    value:
      "مبروك {{name}} 🎉\nاشتراك {{platform}} تم تفعيله بنجاح من متجر مايسترو كي 🔑\n{{credentials}}\n⏳ صالح حتى: {{end_date}}\nمشاهدة سعيدة! إذا احتجت أي مساعدة تواصل معنا.",
  },
  {
    key: "whatsapp_payment_confirmed_template",
    value:
      "مرحباً {{name}} ✅\nتم تأكيد استلام دفعتك لاشتراك {{platform}} بنجاح 💳\n⏳ الاشتراك سارٍ حتى: {{end_date}}\nشكراً لثقتك بمتجر مايسترو كي 🔑",
  },
  { key: "store_name", value: "متجر مايسترو كي" },
  { key: "alert_days_before", value: "2" },
  { key: "whatsapp_provider", value: "WHATSAPP_LINK" },
];

/**
 * يَضبط الإعدادات والقوالب الأساسية عند أول تشغيل (بصيغة ON CONFLICT DO NOTHING):
 * - استكمال أي قوالب تنبيهات ناقصة في settings دون استبدال التعديلات اليدوية
 * - عند قاعدة فارغة تماماً: إنشاء حساب المدير والمنصات والبنوك الافتراضية
 */
async function doSeed() {
  await ensureSchema();

  // استكمال قوالب التنبيهات والإعدادات الناقصة دائماً بدون المساس بأي تعديلات يدوية موجودة
  await db.insert(settings).values(DEFAULT_SETTINGS).onConflictDoNothing();

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length) return;

  const initialAdminPassword = process.env.ADMIN_INITIAL_PASSWORD?.trim() || "admin123";
  await db
    .insert(users)
    .values([
      {
        username: "admin",
        email: "almaystrwbady@gmail.com",
        passwordHash: await bcrypt.hash(initialAdminPassword, 10),
        displayName: "مدير مايسترو كي",
        role: "ADMIN",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(platforms)
    .values([
      { name: "نتفليكس Netflix", color: "#b91c1c", shortName: "N", imageUrl: "/platforms/netflix.png" },
      { name: "شاهد VIP", color: "#6d28d9", shortName: "ش", imageUrl: "/platforms/shahid.png" },
      { name: "ديزني+ Disney", color: "#1e3a5f", shortName: "D+", imageUrl: "/platforms/disney.png" },
      { name: "يوتيوب بريميوم", color: "#dc2626", shortName: "▶", imageUrl: "/platforms/youtube.png" },
      { name: "OSN+", color: "#0f766e", shortName: "O", imageUrl: "/platforms/osn.png" },
      { name: "TOD / beIN", color: "#7c2d12", shortName: "T", imageUrl: "/platforms/tod.png" },
    ])
    .onConflictDoNothing();

  await db
    .insert(paymentMethods)
    .values([
      { name: "بنك الكريمي" },
      { name: "بنك عدن" },
      { name: "بنك القطيبي" },
      { name: "حواله عبر الشبكة الموحدة" },
    ])
    .onConflictDoNothing();
}

let isSeedChecked = false;

const globalForSeed = globalThis as typeof globalThis & {
  __maestroSeededDone?: boolean;
  __maestroSeedingPromise?: Promise<void> | null;
};

export async function ensureSeeded() {
  if (isSeedChecked || globalForSeed.__maestroSeededDone) return;
  if (!process.env.DATABASE_URL?.trim() && !process.env.FALLBACK_DATABASE_URL?.trim() && !process.env.DATABASE_BACKUP_URL?.trim()) {
    isSeedChecked = true;
    return;
  }
  if (globalForSeed.__maestroSeedingPromise) return globalForSeed.__maestroSeedingPromise;

  globalForSeed.__maestroSeedingPromise = (async () => {
    await doSeed();
    isSeedChecked = true;
    globalForSeed.__maestroSeededDone = true;
  })().catch((e) => {
    console.error("[seed failed]", e);
    isSeedChecked = false;
    globalForSeed.__maestroSeededDone = false;
    globalForSeed.__maestroSeedingPromise = null;
  });

  return globalForSeed.__maestroSeedingPromise;
}
