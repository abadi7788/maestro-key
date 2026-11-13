import { pool } from "@/db";

/**
 * ترقية وتأسيس ذاتي لقاعدة البيانات (Auto-Create & Self-Healing Schema).
 *
 * عند الاتصال بقاعدة Supabase جديدة وفارغة تماماً:
 *  1) يستخدم اتصالاً واحداً من الـ Pool (client = await pool.connect) بدلاً من فتح 122 اتصالاً
 *  2) ينشئ جميع الجداول الـ 16 كاملة بجميع أعمدتها وقيودها وفهارسها دفعة واحدة
 *  3) يُجري الترقية الآمنة (ADD COLUMN IF NOT EXISTS) فقط عند الحاجة لقواعد البيانات القديمة
 *  4) يتحقق فعلياً من وجود الجداول الـ 16 في information_schema قبل اعتماد _schema_meta
 *  5) في حال فشل الاتصال أو تعذر إنشاء جدول، لا يُعلّم المخطط كمكتمل ويُسجّل سبب الخطأ الحقيقي
 */

const REQUIRED_TABLES = [
  "users",
  "platforms",
  "payment_methods",
  "customers",
  "accounts",
  "profiles",
  "rentals",
  "payments",
  "alerts",
  "push_subscriptions",
  "email_codes",
  "audit_logs",
  "settings",
  "whatsapp_logs",
  "wallet_balances",
  "wallet_transactions",
] as const;

// ---------- 1) إنشاء الجداول الـ 16 كاملة من الصفر (قواعد البيانات الفارغة والجديدة) ----------
const CREATE_TABLE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    wallet_balance NUMERIC(12, 2) DEFAULT '0.00',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP,
    last_login_at TIMESTAMP,
    email VARCHAR(180),
    permissions TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS platforms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    color VARCHAR(20) NOT NULL DEFAULT '#0f172a',
    short_name VARCHAR(10) NOT NULL DEFAULT '▶',
    image_url TEXT,
    delivery_mode VARCHAR(20) NOT NULL DEFAULT 'INSTANT_INVENTORY',
    requires_customer_email BOOLEAN NOT NULL DEFAULT FALSE,
    extra_field_label VARCHAR(200),
    is_lifetime BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    low_stock_threshold INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS payment_methods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    phone VARCHAR(40) NOT NULL UNIQUE,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    platform_id INTEGER NOT NULL REFERENCES platforms(id),
    type VARCHAR(20) NOT NULL DEFAULT 'FULL',
    max_profiles INTEGER NOT NULL DEFAULT 1,
    delivery_kind VARCHAR(20) NOT NULL DEFAULT 'CREDENTIALS',
    email VARCHAR(200),
    password_encrypted TEXT,
    invite_link TEXT,
    license_key_encrypted TEXT,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
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
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    sold_at TIMESTAMP,
    sold_by INTEGER REFERENCES users(id),
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
    delivery_source VARCHAR(20) NOT NULL DEFAULT 'AUTO',
    manual_email VARCHAR(200),
    manual_password_encrypted TEXT,
    manual_link TEXT,
    manual_code_encrypted TEXT,
    manual_note TEXT,
    refunded_at TIMESTAMP,
    refund_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    rental_id INTEGER NOT NULL REFERENCES rentals(id),
    payment_method_id INTEGER REFERENCES payment_methods(id),
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
    endpoint TEXT NOT NULL UNIQUE,
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
    key VARCHAR(120) NOT NULL UNIQUE,
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
  `CREATE TABLE IF NOT EXISTS wallet_balances (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    rental_id INTEGER REFERENCES rentals(id),
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,
];

// ---------- 2) الفهارس الأساسية ----------
const INDEX_STATEMENTS: string[] = [
  `CREATE INDEX IF NOT EXISTS accounts_platform_idx ON accounts(platform_id)`,
  `CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS profiles_account_no_idx ON profiles(account_id, profile_no)`,
  `CREATE INDEX IF NOT EXISTS profiles_available_idx ON profiles(account_id, status, id)`,
  `CREATE INDEX IF NOT EXISTS rentals_customer_idx ON rentals(customer_id)`,
  `CREATE INDEX IF NOT EXISTS rentals_status_idx ON rentals(status)`,
  `CREATE INDEX IF NOT EXISTS rentals_account_idx ON rentals(account_id)`,
  `CREATE INDEX IF NOT EXISTS payments_rental_idx ON payments(rental_id)`,
  `CREATE INDEX IF NOT EXISTS wallet_balances_user_idx ON wallet_balances(user_id)`,
  `CREATE INDEX IF NOT EXISTS wallet_transactions_user_idx ON wallet_transactions(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS wallet_transactions_rental_idx ON wallet_transactions(rental_id)`,
];

// ---------- 3) ترقية الأعمدة الناقصة لقواعد البيانات القديمة فقط ----------
const UPGRADE_STATEMENTS: string[] = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(180)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'USER'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) DEFAULT '0.00'`,

  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS image_url TEXT`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20) NOT NULL DEFAULT 'INSTANT_INVENTORY'`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS requires_customer_email BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS extra_field_label VARCHAR(200)`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 3`,

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
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS delivery_kind VARCHAR(20) NOT NULL DEFAULT 'CREDENTIALS'`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS invite_link TEXT`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS license_key_encrypted TEXT`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_uses INTEGER`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS used_count INTEGER NOT NULL DEFAULT 0`,

  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_name VARCHAR(80)`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin VARCHAR(40)`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_occupied BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_rental_id INTEGER`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sold_at TIMESTAMP`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sold_by INTEGER REFERENCES users(id)`,

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
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS delivery_source VARCHAR(20) NOT NULL DEFAULT 'AUTO'`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_email VARCHAR(200)`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_password_encrypted TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_link TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_code_encrypted TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_note TEXT`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS refund_reason TEXT`,
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
  `ALTER TABLE payments ALTER COLUMN payment_method_id DROP NOT NULL`,

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

  `ALTER TABLE accounts ALTER COLUMN expiry_date DROP NOT NULL`,
  `ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL`,
  `ALTER TABLE accounts ALTER COLUMN password_encrypted DROP NOT NULL`,
  `ALTER TABLE accounts ALTER COLUMN delivery_kind SET DEFAULT 'CREDENTIALS'`,
  `ALTER TABLE accounts ALTER COLUMN used_count SET DEFAULT 0`,
  `ALTER TABLE rentals ALTER COLUMN account_id DROP NOT NULL`,
  `ALTER TABLE rentals ALTER COLUMN delivery_source SET DEFAULT 'AUTO'`,
  `ALTER TABLE platforms ALTER COLUMN delivery_mode SET DEFAULT 'INSTANT_INVENTORY'`,
  `ALTER TABLE platforms ALTER COLUMN requires_customer_email SET DEFAULT FALSE`,
  `ALTER TABLE platforms ALTER COLUMN is_lifetime SET DEFAULT FALSE`,
  `ALTER TABLE rentals ALTER COLUMN is_lifetime SET DEFAULT FALSE`,
  `ALTER TABLE rentals ALTER COLUMN activation_status SET DEFAULT 'NOT_REQUIRED'`,
  `UPDATE profiles SET status = 'SOLD', sold_at = created_at WHERE is_occupied = true AND status = 'AVAILABLE'`,
  `UPDATE profiles SET status = 'AVAILABLE' WHERE is_occupied = false AND status = 'SOLD'`,
  `UPDATE platforms SET delivery_mode = 'INSTANT_INVENTORY' WHERE delivery_mode = 'INVENTORY'`,
  `UPDATE platforms SET delivery_mode = 'ON_DEMAND_EMAIL' WHERE delivery_mode = 'ON_DEMAND'`,
];

const SCHEMA_META_VERSION = 2;

let isSchemaChecked = false;

const globalForSchema = globalThis as typeof globalThis & {
  __maestroSchemaEnsured?: boolean;
  __maestroSchemaPromise?: Promise<void> | null;
};

async function getExistingPublicTables(queryable: { query: (sql: string) => Promise<{ rows: any[] }> }): Promise<Set<string>> {
  const res = await queryable.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  return new Set((res.rows || []).map((r: any) => String(r.table_name)));
}

export async function ensureSchema(): Promise<void> {
  if (isSchemaChecked || globalForSchema.__maestroSchemaEnsured) return;
  if (!process.env.DATABASE_URL?.trim()) {
    isSchemaChecked = true;
    return;
  }
  if (globalForSchema.__maestroSchemaPromise) return globalForSchema.__maestroSchemaPromise;

  globalForSchema.__maestroSchemaPromise = (async () => {
    // 0) فحص فائق السرعة (استعلام واحد فقط): إذا كان المخطط مؤسساً مسبقاً نخرج فوراً
    try {
      const fastCheck = await pool.query(
        `SELECT version FROM _schema_meta WHERE version = $1 LIMIT 1`,
        [SCHEMA_META_VERSION]
      );
      if (fastCheck.rows?.length) {
        isSchemaChecked = true;
        globalForSchema.__maestroSchemaEnsured = true;
        return;
      }
    } catch {
      // الجدول غير موجود أو القاعدة جديدة — نتابع التهيئة الكاملة
    }

    const client = await pool.connect();
    try {
      // ضمان العمل داخل public schema في Supabase / Postgres
      try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS public`);
        await client.query(`SET search_path TO public`);
      } catch {
        // تجاهل إذا كانت الصلاحية مقيدة وكان public موجوداً بالفعل
      }

      // 1) فحص الجداول الموجودة حالياً
      const initialTables = await getExistingPublicTables(client);
      const missingBefore = REQUIRED_TABLES.filter((t) => !initialTables.has(t));
      const isFreshDatabase = missingBefore.length === REQUIRED_TABLES.length;
      const errors: string[] = [];

      // 2) إنشاء جميع الجداول الـ 16 بالترتيب (CREATE TABLE IF NOT EXISTS)
      for (const sql of CREATE_TABLE_STATEMENTS) {
        try {
          await client.query(sql);
        } catch (err: any) {
          const msg = err?.message || String(err);
          errors.push(msg);
          console.error("[schema-check] CREATE TABLE error:", msg);
        }
      }

      // 3) إذا كانت قاعدة بيانات قديمة (ليست فارغة)، ننفذ ترقية الأعمدة الناقصة
      if (!isFreshDatabase) {
        for (const sql of UPGRADE_STATEMENTS) {
          try {
            await client.query(sql);
          } catch (err: any) {
            const msg = err?.message || String(err);
            if (errors.length < 5) errors.push(msg);
          }
        }
      }

      // 4) إنشاء الفهارس الأساسية (حتى على القاعدة الجديدة)
      for (const sql of INDEX_STATEMENTS) {
        try {
          await client.query(sql);
        } catch (err: any) {
          const msg = err?.message || String(err);
          if (errors.length < 5) errors.push(msg);
        }
      }

      // 5) تحقق فعلي من وجود جميع الجداول الـ 16 في القاعدة قبل اعتماد المخطط
      const finalTables = await getExistingPublicTables(client);
      const stillMissing = REQUIRED_TABLES.filter((t) => !finalTables.has(t));

      if (stillMissing.length > 0) {
        throw new Error(
          `تعذر إنشاء الجداول التالية (${stillMissing.join(", ")}): ${errors[0] || "خطأ غير معروف"}`
        );
      }

      // 6) تسجيل اكتمال المخطط بنجاح
      await client.query(
        `CREATE TABLE IF NOT EXISTS _schema_meta (version INT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`
      );
      await client.query(
        `INSERT INTO _schema_meta (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
        [SCHEMA_META_VERSION]
      );

      isSchemaChecked = true;
      globalForSchema.__maestroSchemaEnsured = true;
      console.log(
        `[schema-check] ${isFreshDatabase ? "Fresh database initialized (16 tables created)" : "Schema verified & upgraded"} successfully.`
      );
    } finally {
      client.release();
    }
  })().catch((e) => {
    console.error("[schema-check] error:", e?.message || e);
    isSchemaChecked = false;
    globalForSchema.__maestroSchemaEnsured = false;
    globalForSchema.__maestroSchemaPromise = null;
    throw e;
  });

  return globalForSchema.__maestroSchemaPromise;
}
