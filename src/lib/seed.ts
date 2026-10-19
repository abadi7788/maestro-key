import { db } from "@/db";
import { users, platforms, paymentMethods, settings } from "@/db/schema";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

let seeding: Promise<void> | null = null;

/** First initialization only. Never resets existing staff, inventory, or payments. */
async function doSeed() {
  await db.transaction(async (tx) => {
    // A single transaction/advisory lock also makes first boot safe across instances.
    await tx.execute(sql`select pg_advisory_xact_lock(683912041)`);
    const existing = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing.length) return;
    if (process.env.STORE_INITIALIZATION === "restore") {
      throw new Error("Store restore is pending. Import the existing store data before accepting logins.");
    }
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error("Set ADMIN_INITIAL_PASSWORD (at least 12 characters) before initializing a new store.");
    }

    await tx.insert(users).values({
      username: "admin",
      email: "almaystrwbady@gmail.com",
      passwordHash: await bcrypt.hash(password, 12),
      displayName: "مدير مايسترو كي",
      role: "ADMIN",
    });
    await tx.insert(platforms).values([
      { name: "نتفليكس Netflix", color: "#b91c1c", shortName: "N", imageUrl: "/platforms/netflix.png" },
      { name: "شاهد VIP", color: "#6d28d9", shortName: "ش", imageUrl: "/platforms/shahid.png" },
      { name: "ديزني+ Disney", color: "#1e3a5f", shortName: "D+", imageUrl: "/platforms/disney.png" },
      { name: "يوتيوب بريميوم", color: "#dc2626", shortName: "▶", imageUrl: "/platforms/youtube.png" },
      { name: "OSN+", color: "#0f766e", shortName: "O", imageUrl: "/platforms/osn.png" },
      { name: "TOD / beIN", color: "#7c2d12", shortName: "T", imageUrl: "/platforms/tod.png" },
    ]);
    await tx.insert(paymentMethods).values([
      { name: "بنك الكريمي" },
      { name: "بنك عدن" },
      { name: "بنك القطيبي" },
      { name: "حواله عبر الشبكة الموحدة" },
    ]);
    await tx.insert(settings).values([
      { key: "whatsapp_expiry_template", value: "مرحباً {{name}} 👋\nتنبيه من متجر مايسترو كي 🔑\nاشتراكك في {{platform}} سينتهي بتاريخ {{end_date}} (بعد {{days}} يوم).\nللتجديد بدون انقطاع، حوّل مبلغ التجديد وأرسل السند هنا وسنمدّد اشتراكك فوراً.\nشكراً لثقتك بنا." },
      { key: "whatsapp_sale_template", value: "مرحباً {{name}} 🎉\nتم تفعيل اشتراك {{platform}} بنجاح من متجر مايسترو كي 🔑\n📧 الإيميل: {{email}}\n🔑 كلمة المرور: {{password}}\n👤 البروفايل/PIN: {{profile}}\n⏳ صالح حتى: {{end_date}}\nمشاهدة سعيدة! لا تشارك البيانات مع أحد." },
      { key: "whatsapp_renewal_template", value: "مرحباً {{name}} ✅\nتم تجديد اشتراك {{platform}} بنجاح حتى {{end_date}}.\nنفس بيانات الدخول السابقة تعمل بدون تغيير.\nمتجر مايسترو كي 🔑" },
      { key: "store_name", value: "متجر مايسترو كي" },
      { key: "alert_days_before", value: "2" },
      { key: "whatsapp_provider", value: "WHATSAPP_LINK" },
    ]);
  });
}

export async function ensureSeeded() {
  if (!seeding) seeding = doSeed().catch((error) => {
    seeding = null;
    throw error;
  });
  await seeding;
}
