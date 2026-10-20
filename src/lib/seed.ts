import { db } from "@/db";
import { users, platforms, paymentMethods, settings } from "@/db/schema";
import { ensureSchema } from "./schema-check";
import bcrypt from "bcryptjs";

let seeding: Promise<void> | null = null;

/**
 * يَضبط الإعدادات الأساسية فقط عند أول تشغيل:
 * - مستخدموا النظام (المدير + موظف تجريبي)
 * - المنصات
 * - البنوك / وسائل الدفع
 * - قوالب الواتساب والإعدادات
 *
 * ملاحظة مهمة: لا يُضاف أي حساب مخزون أو عميل أو عملية بيع تلقائياً —
 * يضيفها المدير يدوياً من شاشات النظام (المخزون / العملاء / نقطة البيع).
 */
async function doSeed() {
  // أولاً: تأكد من اكتمال المخطط (يصلح قواعد البيانات القديمة تلقائياً قبل أي استعلام)
  await ensureSchema();
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length) return;

  await db.insert(users).values([
    { username: "admin", passwordHash: await bcrypt.hash("admin123", 10), displayName: "مدير مايسترو كي", role: "ADMIN" },
  ]);

  await db.insert(platforms).values([
    { name: "نتفليكس Netflix", color: "#b91c1c", shortName: "N", imageUrl: "/platforms/netflix.png" },
    { name: "شاهد VIP", color: "#6d28d9", shortName: "ش", imageUrl: "/platforms/shahid.png" },
    { name: "ديزني+ Disney", color: "#1e3a5f", shortName: "D+", imageUrl: "/platforms/disney.png" },
    { name: "يوتيوب بريميوم", color: "#dc2626", shortName: "▶", imageUrl: "/platforms/youtube.png" },
    { name: "OSN+", color: "#0f766e", shortName: "O", imageUrl: "/platforms/osn.png" },
    { name: "TOD / beIN", color: "#7c2d12", shortName: "T", imageUrl: "/platforms/tod.png" },
  ]);

  await db.insert(paymentMethods).values([
    { name: "بنك الكريمي" },
    { name: "بنك عدن" },
    { name: "بنك القطيبي" },
    { name: "حواله عبر الشبكة الموحدة" },
  ]);

  await db.insert(settings).values([
    { key: "whatsapp_expiry_template", value: "مرحباً {{name}} 👋\nتنبيه من متجر مايسترو كي 🔑\nاشتراكك في {{platform}} سينتهي بتاريخ {{end_date}} (بعد {{days}} يوم).\nللتجديد بدون انقطاع، حوّل مبلغ التجديد وأرسل السند هنا وسنمدّد اشتراكك فوراً.\nشكراً لثقتك بنا." },
    { key: "whatsapp_sale_template", value: "مرحباً {{name}} 🎉\nتم تفعيل اشتراك {{platform}} بنجاح من متجر مايسترو كي 🔑\n📧 الإيميل: {{email}}\n🔑 كلمة المرور: {{password}}\n👤 البروفايل/PIN: {{profile}}\n⏳ صالح حتى: {{end_date}}\nمشاهدة سعيدة! لا تشارك البيانات مع أحد." },
    { key: "whatsapp_renewal_template", value: "مرحباً {{name}} ✅\nتم تجديد اشتراك {{platform}} بنجاح حتى {{end_date}}.\nنفس بيانات الدخول السابقة تعمل بدون تغيير.\nمتجر مايسترو كي 🔑" },
    { key: "whatsapp_activation_template", value: "مبروك {{name}} 🎉\nاشتراك {{platform}} تم تفعيله بنجاح من متجر مايسترو كي 🔑\n{{credentials}}\n⏳ صالح حتى: {{end_date}}\nتمتعة سعيدة! إذا احتجت أي مساعدة تواصل معنا." },
    { key: "store_name", value: "متجر مايسترو كي" },
    { key: "alert_days_before", value: "2" },
    { key: "whatsapp_provider", value: "WHATSAPP_LINK" },
  ]);
}

export async function ensureSeeded() {
  if (!seeding) seeding = doSeed().catch((e) => { console.error("[seed failed]", e); seeding = null; });
  await seeding;
}
