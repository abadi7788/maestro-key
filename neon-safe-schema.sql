-- ============================================================
--  Maestro Key — ملف تهيئة قاعدة البيانات الآمن (Safe Schema)
--  متوافق مع الكود الحالي (أنماط التسليم الثلاثة + الاشتراك الدائم + التفعيل)
--
--  طريقة التشغيل: الصق الملف كاملاً في Neon Console ← SQL Editor ← Run
--
--  ضمانات الأمان:
--  • لا يوجد أي أمر حذف بيانات: لا DROP ولا DELETE ولا TRUNCATE
--  • كل الأوامر بصيغة IF NOT EXISTS — آمنة للتكرار أكثر من مرة
--  • الأعمدة الجديدة لها قيم افتراضية فتُملأ تلقائياً للصفوف القديمة
--  • أعمدة NOT NULL القديمة التي أصبحت اختيارية تُرخّى فقط (DROP NOT NULL)
--  • تحديثات القيم (UPDATE) مقتصرة على توحيد أسماء أنماط التسليم القديمة
--  • الفهارس الفريدة وإدخال الإعدادات مغلفة بمعالجات أخطاء، فلا يُجهض
--    الملف كاملاً بسبب بيانات مكررة قديمة (سبب شائع لفشل التطبيق السابق)
-- ============================================================

BEGIN;

-- ============================================================
-- القسم 1: إنشاء الجداول (يُنشأ الناقص فقط — الموجود يُتجاهل)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
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
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT users_username_unique UNIQUE (username)
);

CREATE TABLE IF NOT EXISTS platforms (
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
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT platforms_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT customers_phone_unique UNIQUE (phone)
);

CREATE TABLE IF NOT EXISTS accounts (
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
);

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_no INTEGER NOT NULL,
  profile_name VARCHAR(80),
  pin VARCHAR(40),
  is_occupied BOOLEAN NOT NULL DEFAULT FALSE,
  current_rental_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rentals (
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
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
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
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  kind VARCHAR(40) NOT NULL DEFAULT 'INFO',
  href VARCHAR(200),
  for_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE TABLE IF NOT EXISTS email_codes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(180) NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  username VARCHAR(80),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60),
  entity_id INTEGER,
  details TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(120) NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT settings_key_unique UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id SERIAL PRIMARY KEY,
  rental_id INTEGER REFERENCES rentals(id),
  customer_id INTEGER REFERENCES customers(id),
  phone VARCHAR(40) NOT NULL,
  message TEXT NOT NULL,
  kind VARCHAR(40) NOT NULL DEFAULT 'EXPIRY_WARNING',
  status VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ============================================================
-- القسم 2: إضافة الأعمدة الناقصة للجداول الموجودة
-- (كل أمر يتجاهل العمود إن كان موجوداً — والقيم الافتراضية
--  تُملأ تلقائياً للصفوف القديمة، فلا تُفقد أي بيانات)
-- ============================================================

-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(180);
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'EMPLOYEE';

-- platforms (أعمدة أنماط التسليم الجديدة)
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20) NOT NULL DEFAULT 'INSTANT_INVENTORY';
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS requires_customer_email BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS extra_field_label VARCHAR(200);
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN NOT NULL DEFAULT FALSE;

-- accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pin VARCHAR(40);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sale_price INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'AVAILABLE';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_profiles INTEGER DEFAULT 1;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'FULL';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS delivery_kind VARCHAR(20) NOT NULL DEFAULT 'CREDENTIALS';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS invite_link TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS license_key_encrypted TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_uses INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS used_count INTEGER NOT NULL DEFAULT 0;

-- profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_name VARCHAR(80);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin VARCHAR(40);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_occupied BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_rental_id INTEGER;

-- customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;

-- rentals (أعمدة التفعيل والاشتراك الدائم الجديدة)
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS rental_type VARCHAR(20) DEFAULT 'NEW';
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS password_used_encrypted TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS whatsapp_alert_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS whatsapp_alert_sent_at TIMESTAMP;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS customer_email VARCHAR(200);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS customer_extra TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activation_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_email VARCHAR(200);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_password TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_link TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_pin VARCHAR(40);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_note TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_by INTEGER;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS delivery_source VARCHAR(20) NOT NULL DEFAULT 'AUTO';
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_email VARCHAR(200);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_password_encrypted TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_link TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_code_encrypted TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS manual_note TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();

-- payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_image_data TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_hash VARCHAR(128);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_extension BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_end_date TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_rental_status VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PENDING';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount INTEGER DEFAULT 0;

-- audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR(80);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(60);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT;

-- settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();

-- whatsapp_logs
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS rental_id INTEGER;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS kind VARCHAR(40) DEFAULT 'EXPIRY_WARNING';
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'QUEUED';

-- alerts
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS kind VARCHAR(40) DEFAULT 'INFO';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS href VARCHAR(200);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS for_user_id INTEGER;

-- ============================================================
-- القسم 3: ترخية قيود NOT NULL القديمة (بدون حذف بيانات)
--  • الحساب قد يكون بلا تاريخ انتهاء (اشتراك دائم)
--  • الطلب قد يكون بلا حساب مخزون (تفعيل عند الطلب / برابط)
-- ============================================================

ALTER TABLE accounts ALTER COLUMN expiry_date DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN password_encrypted DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN delivery_kind SET DEFAULT 'CREDENTIALS';
ALTER TABLE accounts ALTER COLUMN used_count SET DEFAULT 0;
ALTER TABLE rentals ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE rentals ALTER COLUMN delivery_source SET DEFAULT 'AUTO';

-- ضمان القيم الافتراضية حتى لو أُضيفت الأعمدة يدوياً من قبل بدونها
ALTER TABLE platforms ALTER COLUMN delivery_mode SET DEFAULT 'INSTANT_INVENTORY';
ALTER TABLE platforms ALTER COLUMN requires_customer_email SET DEFAULT FALSE;
ALTER TABLE platforms ALTER COLUMN is_lifetime SET DEFAULT FALSE;
ALTER TABLE rentals ALTER COLUMN is_lifetime SET DEFAULT FALSE;
ALTER TABLE rentals ALTER COLUMN activation_status SET DEFAULT 'NOT_REQUIRED';

-- ============================================================
-- القسم 4: توحيد أسماء أنماط التسليم القديمة (تحديث قيم فقط)
-- ============================================================

UPDATE platforms SET delivery_mode = 'INSTANT_INVENTORY' WHERE delivery_mode = 'INVENTORY';
UPDATE platforms SET delivery_mode = 'ON_DEMAND_EMAIL' WHERE delivery_mode = 'ON_DEMAND';

-- ============================================================
-- القسم 5: قيود UNIQUE الناقصة (تُتجاهل إن وُجدت، وتنبّه فقط إن تعارضت)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_username_unique') THEN
    BEGIN
      ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي: يوجد أسماء مستخدمين مكررة في users'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platforms_name_unique') THEN
    BEGIN
      ALTER TABLE platforms ADD CONSTRAINT platforms_name_unique UNIQUE (name);
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي: يوجد أسماء منصات مكررة في platforms'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_methods_name_unique') THEN
    BEGIN
      ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_name_unique UNIQUE (name);
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي: يوجد بنوك مكررة في payment_methods'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_phone_unique') THEN
    BEGIN
      ALTER TABLE customers ADD CONSTRAINT customers_phone_unique UNIQUE (phone);
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي: يوجد أرقام هواتف مكررة في customers'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_endpoint_unique') THEN
    BEGIN
      ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint);
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي: يوجد اشتراكات دفع مكررة في push_subscriptions'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_key_unique') THEN
    BEGIN
      ALTER TABLE settings ADD CONSTRAINT settings_key_unique UNIQUE (key);
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي: يوجد مفاتيح إعدادات مكررة في settings'; END;
  END IF;
END $$;

-- ============================================================
-- القسم 6: المفاتيح الخارجية الناقصة (تُتجاهل إن وُجدت)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'alerts'::regclass AND c.contype = 'f' AND a.attname = 'for_user_id') THEN
    BEGIN
      ALTER TABLE alerts ADD CONSTRAINT alerts_for_user_id_users_id_fk FOREIGN KEY (for_user_id) REFERENCES users(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: alerts.for_user_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'push_subscriptions'::regclass AND c.contype = 'f' AND a.attname = 'user_id') THEN
    BEGIN
      ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: push_subscriptions.user_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'accounts'::regclass AND c.contype = 'f' AND a.attname = 'platform_id') THEN
    BEGIN
      ALTER TABLE accounts ADD CONSTRAINT accounts_platform_id_platforms_id_fk FOREIGN KEY (platform_id) REFERENCES platforms(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: accounts.platform_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'profiles'::regclass AND c.contype = 'f' AND a.attname = 'account_id') THEN
    BEGIN
      ALTER TABLE profiles ADD CONSTRAINT profiles_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: profiles.account_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'rentals'::regclass AND c.contype = 'f' AND a.attname = 'account_id') THEN
    BEGIN
      ALTER TABLE rentals ADD CONSTRAINT rentals_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES accounts(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: rentals.account_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'rentals'::regclass AND c.contype = 'f' AND a.attname = 'profile_id') THEN
    BEGIN
      ALTER TABLE rentals ADD CONSTRAINT rentals_profile_id_profiles_id_fk FOREIGN KEY (profile_id) REFERENCES profiles(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: rentals.profile_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'rentals'::regclass AND c.contype = 'f' AND a.attname = 'customer_id') THEN
    BEGIN
      ALTER TABLE rentals ADD CONSTRAINT rentals_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES customers(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: rentals.customer_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'rentals'::regclass AND c.contype = 'f' AND a.attname = 'platform_id') THEN
    BEGIN
      ALTER TABLE rentals ADD CONSTRAINT rentals_platform_id_platforms_id_fk FOREIGN KEY (platform_id) REFERENCES platforms(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: rentals.platform_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'rentals'::regclass AND c.contype = 'f' AND a.attname = 'created_by') THEN
    BEGIN
      ALTER TABLE rentals ADD CONSTRAINT rentals_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: rentals.created_by يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'rentals'::regclass AND c.contype = 'f' AND a.attname = 'activated_by') THEN
    BEGIN
      ALTER TABLE rentals ADD CONSTRAINT rentals_activated_by_users_id_fk FOREIGN KEY (activated_by) REFERENCES users(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: rentals.activated_by يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'payments'::regclass AND c.contype = 'f' AND a.attname = 'rental_id') THEN
    BEGIN
      ALTER TABLE payments ADD CONSTRAINT payments_rental_id_rentals_id_fk FOREIGN KEY (rental_id) REFERENCES rentals(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: payments.rental_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'payments'::regclass AND c.contype = 'f' AND a.attname = 'payment_method_id') THEN
    BEGIN
      ALTER TABLE payments ADD CONSTRAINT payments_payment_method_id_fk FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: payments.payment_method_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'payments'::regclass AND c.contype = 'f' AND a.attname = 'reviewed_by') THEN
    BEGIN
      ALTER TABLE payments ADD CONSTRAINT payments_reviewed_by_users_id_fk FOREIGN KEY (reviewed_by) REFERENCES users(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: payments.reviewed_by يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'payments'::regclass AND c.contype = 'f' AND a.attname = 'created_by') THEN
    BEGIN
      ALTER TABLE payments ADD CONSTRAINT payments_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: payments.created_by يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'audit_logs'::regclass AND c.contype = 'f' AND a.attname = 'user_id') THEN
    BEGIN
      ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: audit_logs.user_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'whatsapp_logs'::regclass AND c.contype = 'f' AND a.attname = 'rental_id') THEN
    BEGIN
      ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_rental_id_rentals_id_fk FOREIGN KEY (rental_id) REFERENCES rentals(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: whatsapp_logs.rental_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'whatsapp_logs'::regclass AND c.contype = 'f' AND a.attname = 'customer_id') THEN
    BEGIN
      ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES customers(id);
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'تخطي FK: whatsapp_logs.customer_id يشير لصفوف محذوفة'; END;
  END IF;
END $$;

-- ============================================================
-- القسم 7: الفهارس (تُتجاهل إن وُجدت)
-- ============================================================

CREATE INDEX IF NOT EXISTS accounts_platform_idx ON accounts(platform_id);
CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status);
CREATE INDEX IF NOT EXISTS rentals_customer_idx ON rentals(customer_id);
CREATE INDEX IF NOT EXISTS rentals_status_idx ON rentals(status);
CREATE INDEX IF NOT EXISTS rentals_account_idx ON rentals(account_id);
-- الفهارس الفريدة مغلفة بمعالج أخطاء: إن وُجدت بيانات مكررة قديمة
-- يُسجَّل تنبيه فقط ولا تُجهَض المعاملة كاملة (هذا ما كان يُفشل الملف سابقاً)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS profiles_account_no_idx ON profiles(account_id, profile_no);
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي الفهرس profiles_account_no_idx: توجد صفوف مكررة قديمة';
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS payments_method_ref_idx ON payments(payment_method_id, transaction_ref);
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'تخطي الفهرس payments_method_ref_idx: توجد سندات مكررة قديمة';
END $$;

-- ============================================================
-- القسم 8: الإعدادات الافتراضية (تُضاف الناقصة فقط — لا تُمس الموجودة)
-- ============================================================

-- ملاحظة: بصيغة WHERE NOT EXISTS بدل ON CONFLICT حتى لا يفشل الإدخال
-- لو كان قيد UNIQUE على settings.key غير موجود في قاعدة قديمة
INSERT INTO settings (key, value)
SELECT v.key, v.value FROM (VALUES
  ('whatsapp_expiry_template', $$مرحباً {{name}} 👋
تنبيه من متجر مايسترو كي 🔑
اشتراكك في {{platform}} سينتهي بتاريخ {{end_date}} (بعد {{days}} يوم).
للتجديد بدون انقطاع، حوّل مبلغ التجديد وأرسل السند هنا وسنمدّد اشتراكك فوراً.
شكراً لثقتك بنا.$$),
  ('whatsapp_sale_template', $$مرحباً {{name}} 🎉
تم تفعيل اشتراك {{platform}} بنجاح من متجر مايسترو كي 🔑
📧 الإيميل: {{email}}
🔑 كلمة المرور: {{password}}
👤 البروفايل/PIN: {{profile}}
⏳ صالح حتى: {{end_date}}
مشاهدة سعيدة! لا تشارك البيانات مع أحد.$$),
  ('whatsapp_renewal_template', $$مرحباً {{name}} ✅
تم تجديد اشتراك {{platform}} بنجاح حتى {{end_date}}.
نفس بيانات الدخول السابقة تعمل بدون تغيير.
متجر مايسترو كي 🔑$$),
  ('whatsapp_activation_template', $$مبروك {{name}} 🎉
اشتراك {{platform}} تم تفعيله بنجاح من متجر مايسترو كي 🔑
{{credentials}}
⏳ صالح حتى: {{end_date}}
تمتعة سعيدة! إذا احتجت أي مساعدة تواصل معنا.$$),
  ('store_name', 'متجر مايسترو كي'),
  ('alert_days_before', '2'),
  ('whatsapp_provider', 'WHATSAPP_LINK')
) AS v(key, value)
WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = v.key);

COMMIT;

-- ============================================================
-- القسم 9: تحقق (قراءة فقط — لا يعدّل شيئاً)
--  • الاستعلام الأول يجب أن يعيد صفر صفوف (أي لا أعمدة ناقصة)
--  • الاستعلام الثاني يعرض عدد الصفوف في كل جدول للتأكد من سلامة البيانات
-- ============================================================

WITH expected(table_name, column_name) AS (VALUES
  ('users','email'),
  ('platforms','image_url'), ('platforms','delivery_mode'), ('platforms','requires_customer_email'),
  ('platforms','extra_field_label'), ('platforms','is_lifetime'),
  ('accounts','pin'), ('accounts','notes'), ('accounts','sale_price'),
  ('accounts','delivery_kind'), ('accounts','invite_link'), ('accounts','license_key_encrypted'),
  ('accounts','max_uses'), ('accounts','used_count'),
  ('profiles','profile_name'), ('profiles','pin'), ('profiles','is_occupied'), ('profiles','current_rental_id'),
  ('customers','notes'),
  ('rentals','is_lifetime'), ('rentals','password_used_encrypted'), ('rentals','whatsapp_alert_sent'),
  ('rentals','customer_email'), ('rentals','customer_extra'), ('rentals','activation_status'),
  ('rentals','activated_email'), ('rentals','activated_password'), ('rentals','activated_link'),
  ('rentals','activated_pin'), ('rentals','activated_note'), ('rentals','activated_at'), ('rentals','activated_by'),
  ('rentals','delivery_source'), ('rentals','manual_email'), ('rentals','manual_password_encrypted'),
  ('rentals','manual_link'), ('rentals','manual_code_encrypted'), ('rentals','manual_note'),
  ('payments','receipt_image_data'), ('payments','receipt_hash'), ('payments','reviewed_by'),
  ('payments','reviewed_at'), ('payments','rejection_reason'), ('payments','is_extension'),
  ('payments','duration_days'), ('payments','previous_end_date'), ('payments','previous_rental_status'), ('payments','created_by'),
  ('audit_logs','user_id'), ('audit_logs','username'), ('audit_logs','entity_type'), ('audit_logs','entity_id'), ('audit_logs','details'),
  ('whatsapp_logs','rental_id'), ('whatsapp_logs','customer_id'), ('whatsapp_logs','kind'), ('whatsapp_logs','status'),
  ('alerts','title'), ('alerts','for_user_id'),
  ('push_subscriptions','endpoint'), ('email_codes','code_hash')
)
SELECT e.table_name AS "جدول ناقص منه عمود", e.column_name AS "العمود الناقص"
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name
WHERE c.column_name IS NULL;

SELECT 'users' AS t, count(*) AS c FROM users UNION ALL
SELECT 'platforms', count(*) FROM platforms UNION ALL
SELECT 'accounts', count(*) FROM accounts UNION ALL
SELECT 'profiles', count(*) FROM profiles UNION ALL
SELECT 'customers', count(*) FROM customers UNION ALL
SELECT 'rentals', count(*) FROM rentals UNION ALL
SELECT 'payments', count(*) FROM payments UNION ALL
SELECT 'alerts', count(*) FROM alerts;
