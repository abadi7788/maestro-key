import { pool } from "@/db";

/**
 * ترقية ذاتية وآمنة لقاعدة البيانات (Self-Healing Schema).
 *
 * المشكلة التي تحلها: عند نشر نسخة جديدة على Vercel/Neon قبل تنفيذ
 * ملف الـ SQL يدوياً، تنهار المسارات التي تستعلم أعمدة جديدة بخطأ 500
 * (مثل: column "is_lifetime" does not exist).
 *
 * الحل: قبل أي استعلام، نتأكد من وجود كل الجداول والأعمدة.
 *  • كل عبارة مستقلة (بدون معاملة واحدة) — فشل عبارة لا يلغي البقية
 *  • كل العبارات بصيغة IF NOT EXISTS — آمنة للتكرار
 *  • لا يوجد أي حذف بيانات إطلاقاً (لا DROP ولا DELETE)
 *  • تعمل مرة واحدة لكل نسخة سيرفر (تُحفظ في الذاكرة)
 */

const STATEMENTS: string[] = [
  // ---------- 1) الجداول (يُنشأ الناقص فقط) ----------
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(80) NOT NULL,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'EMPLOYEE',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP,
    last_login_at TIMESTAMP,
    email VARCHAR(180),
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS platforms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT '#0f172a',
    short_name VARCHAR(10) NOT NULL DEFAULT '▶',
    image_url TEXT,
    delivery_mode VARCHAR(20) NOT NULL DEFAULT 'INSTANT_INVENTORY',
    requires_customer_email BOOLEAN NOT NULL DEFAULT FALSE,
    extra_field_label VARCHAR(200),
    is_lifetime BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS payment_methods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    platform_id INTEGER NOT NULL REFERENCES platforms(id),
    type VARCHAR(20) NOT NULL DEFAULT 'FULL',
    max_profiles INTEGER NOT NULL DEFAULT 1,
    email VARCHAR(200) NOT NULL,
    password_encrypted TEXT NOT NULL,
    pin VARCHAR(40),
    expiry_date TIMESTAMP,
    status VARCHAR(40) NOT NULL DEFAULT 'AVAILABLE',
    notes TEXT,
    sale_price INTEGER,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    profile_no INTEGER NOT NULL,
    profile_name VARCHAR(80),
    pin VARCHAR(40),
    is_occupied BOOLEAN NOT NULL DEFAULT FALSE,
    current_rental_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS rentals (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    profile_id INTEGER REFERENCES profiles(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    platform_id INTEGER NOT NULL REFERENCES platforms(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    rental_type VARCHAR(20) NOT NULL DEFAULT 'NEW',
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    duration_days INTEGER NOT NULL,
    is_lifetime BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    password_used_encrypted TEXT,
    whatsapp_alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_alert_sent_at TIMESTAMP,
    customer_email VARCHAR(200),
    customer_extra TEXT,
    activation_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED',
    activated_email VARCHAR(200),
    activated_password TEXT,
    activated_link TEXT,
    activated_pin VARCHAR(40),
    activated_note TEXT,
    activated_at TIMESTAMP,
    activated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    rental_id INTEGER NOT NULL REFERENCES rentals(id),
    payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
    transaction_ref VARCHAR(160) NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    receipt_image_data TEXT,
    receipt_hash VARCHAR(128),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    rejection_reason TEXT,
    is_extension BOOLEAN NOT NULL DEFAULT FALSE,
    duration_days INTEGER NOT NULL DEFAULT 0,
    previous_end_date TIMESTAMP,
    previous_rental_status VARCHAR(20),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    kind VARCHAR(40) NOT NULL DEFAULT 'INFO',
    href VARCHAR(200),
    for_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS email_codes (
    id SERIAL PRIMARY KEY,
    email VARCHAR(180) NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    username VARCHAR(80),
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(60),
    entity_id INTEGER,
    details TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(120) NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id SERIAL PRIMARY KEY,
    rental_id INTEGER REFERENCES rentals(id),
    customer_id INTEGER REFERENCES customers(id),
    phone VARCHAR(40) NOT NULL,
    message TEXT NOT NULL,
    kind VARCHAR(40) NOT NULL DEFAULT 'EXPIRY_WARNING',
    status VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // ---------- 2) الأعمدة الناقصة ----------
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(180)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'EMPLOYEE'`,

  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS image_url TEXT`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20) NOT NULL DEFAULT 'INSTANT_INVENTORY'`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS requires_customer_email BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS extra_field_label VARCHAR(200)`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN NOT NULL DEFAULT FALSE`,

  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pin VARCHAR(40)`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sale_price INTEGER`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_reason TEXT`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now()`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'AVAILABLE'`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_profiles INTEGER DEFAULT 1`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'FULL'`,

  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_name VARCHAR(80)`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin VARCHAR(40)`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_occupied BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_rental_id INTEGER`,

  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT`,

  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS rental_type VARCHAR(20) DEFAULT 'NEW'`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS password_used_encrypted TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS whatsapp_alert_sent BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS whatsapp_alert_sent_at TIMESTAMP`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS customer_email VARCHAR(200)`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS customer_extra TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activation_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED'`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_email VARCHAR(200)`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_password TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_link TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_pin VARCHAR(40)`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_note TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_by INTEGER`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now()`,

  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_image_data TEXT`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_hash VARCHAR(128)`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_by INTEGER`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_extension BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_end_date TIMESTAMP`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_rental_status VARCHAR(20)`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by INTEGER`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PENDING'`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount INTEGER DEFAULT 0`,

  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id INTEGER`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR(80)`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(60)`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id INTEGER`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT`,

  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now()`,

  `ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS rental_id INTEGER`,
  `ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS customer_id INTEGER`,
  `ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS kind VARCHAR(40) DEFAULT 'EXPIRY_WARNING'`,
  `ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'QUEUED'`,

  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS kind VARCHAR(40) DEFAULT 'INFO'`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS href VARCHAR(200)`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS for_user_id INTEGER`,

  // ---------- 3) ترخية قيود قديمة + ضمان الافتراضيات + توحيد القيم ----------
  `ALTER TABLE accounts ALTER COLUMN expiry_date DROP NOT NULL`,
  `ALTER TABLE rentals ALTER COLUMN account_id DROP NOT NULL`,
  `ALTER TABLE platforms ALTER COLUMN delivery_mode SET DEFAULT 'INSTANT_INVENTORY'`,
  `ALTER TABLE platforms ALTER COLUMN requires_customer_email SET DEFAULT FALSE`,
  `ALTER TABLE platforms ALTER COLUMN is_lifetime SET DEFAULT FALSE`,
  `ALTER TABLE rentals ALTER COLUMN is_lifetime SET DEFAULT FALSE`,
  `ALTER TABLE rentals ALTER COLUMN activation_status SET DEFAULT 'NOT_REQUIRED'`,
  `UPDATE platforms SET delivery_mode = 'INSTANT_INVENTORY' WHERE delivery_mode = 'INVENTORY'`,
  `UPDATE platforms SET delivery_mode = 'ON_DEMAND_EMAIL' WHERE delivery_mode = 'ON_DEMAND'`,
];

let schemaPromise: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    let failed = 0;
    for (const sql of STATEMENTS) {
      try {
        await pool.query(sql);
      } catch (e: unknown) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[schema-check] statement skipped:", msg.slice(0, 160), "|", sql.slice(0, 90));
      }
    }
    if (failed > 0) {
      console.error(`[schema-check] completed with ${failed} skipped statements (non-fatal)`);
    }
  })().catch((e) => {
    // لا نكسر الطلب أبداً بسبب فحص المخطط — سنعيد المحاولة في الطلب التالي
    console.error("[schema-check] failed, will retry next request:", e);
    schemaPromise = null;
  });
  return schemaPromise;
}
