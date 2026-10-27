-- =====================================================================
--  Maestro Key — Safe & Idempotent Database Schema (PostgreSQL / Neon)
--  Version: 2026-10 (matches src/db/schema.ts)
--
--  ✅ SAFE: No DROP TABLE, no DELETE, no data loss.
--  ✅ Uses CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
--     CREATE [UNIQUE] INDEX IF NOT EXISTS, and existence-guarded ADD CONSTRAINT.
--  ✅ Re-runnable: running it again is a complete no-op.
--  ✅ Adds all new columns from the latest features:
--       platforms(delivery_mode, requires_customer_email, extra_field_label)
--       accounts(sale_price)  users(email)
--       rentals(customer_email, customer_extra, activation_status,
--               activated_email, activated_password, activated_link,
--               activated_pin, activated_note, activated_at, activated_by)
--     and relaxes rentals.account_id to nullable (on-demand orders).
--
--  HOW TO RUN: paste the whole file into the Neon SQL Editor and press Run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) TABLES (create only if missing) — ordered by dependency
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(80)  NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  display_name    VARCHAR(120) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'EMPLOYEE',   -- ADMIN | EMPLOYEE
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  failed_attempts INTEGER      NOT NULL DEFAULT 0,
  locked_until    TIMESTAMP,
  last_login_at   TIMESTAMP,
  email           VARCHAR(180),
  created_at      TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platforms (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(120) NOT NULL UNIQUE,
  color                   VARCHAR(20)  NOT NULL DEFAULT '#0f172a',
  short_name              VARCHAR(10)  NOT NULL DEFAULT '▶',
  image_url               TEXT,
  delivery_mode           VARCHAR(20)  NOT NULL DEFAULT 'INVENTORY', -- INVENTORY | ON_DEMAND
  requires_customer_email BOOLEAN      NOT NULL DEFAULT FALSE,
  extra_field_label       VARCHAR(200),
  is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  phone      VARCHAR(40)  NOT NULL UNIQUE,
  notes      TEXT,
  created_at TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id         SERIAL PRIMARY KEY,
  key        VARCHAR(120) NOT NULL UNIQUE,
  value      TEXT         NOT NULL DEFAULT '',
  updated_at TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_codes (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(180) NOT NULL,
  code_hash  TEXT         NOT NULL,
  expires_at TIMESTAMP    NOT NULL,
  used       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id                 SERIAL PRIMARY KEY,
  platform_id        INTEGER NOT NULL REFERENCES platforms(id),
  type               VARCHAR(20) NOT NULL DEFAULT 'FULL',     -- FULL | PROFILE
  max_profiles       INTEGER     NOT NULL DEFAULT 1,
  email              VARCHAR(200) NOT NULL,
  password_encrypted TEXT        NOT NULL,
  pin                VARCHAR(40),
  expiry_date        TIMESTAMP   NOT NULL,
  status             VARCHAR(40) NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE | RENTED | NEEDS_PASSWORD_CHANGE
  notes              TEXT,
  sale_price         INTEGER,
  is_deleted         BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at         TIMESTAMP,
  deleted_reason     TEXT,
  created_at         TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id                SERIAL PRIMARY KEY,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_no        INTEGER NOT NULL,
  profile_name      VARCHAR(80),
  pin               VARCHAR(40),
  is_occupied       BOOLEAN NOT NULL DEFAULT FALSE,
  current_rental_id INTEGER,
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT profiles_account_no_idx UNIQUE (account_id, profile_no)
);

CREATE TABLE IF NOT EXISTS alerts (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  body        TEXT         NOT NULL,
  kind        VARCHAR(40)  NOT NULL DEFAULT 'INFO',
  href        VARCHAR(200),
  for_user_id INTEGER REFERENCES users(id),
  created_at  TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rentals (
  id                      SERIAL PRIMARY KEY,
  account_id              INTEGER REFERENCES accounts(id),          -- nullable (on-demand)
  profile_id              INTEGER REFERENCES profiles(id),
  customer_id             INTEGER NOT NULL REFERENCES customers(id),
  platform_id             INTEGER NOT NULL REFERENCES platforms(id),
  created_by              INTEGER NOT NULL REFERENCES users(id),
  rental_type             VARCHAR(20) NOT NULL DEFAULT 'NEW',      -- NEW | RENEWAL
  start_date              TIMESTAMP NOT NULL,
  end_date                TIMESTAMP NOT NULL,
  duration_days           INTEGER   NOT NULL,
  status                  VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | ENDED | CLOSED | REJECTED
  password_used_encrypted TEXT,
  whatsapp_alert_sent     BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_alert_sent_at  TIMESTAMP,
  customer_email          VARCHAR(200),
  customer_extra          TEXT,
  activation_status       VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED', -- NOT_REQUIRED | PENDING | ACTIVATED
  activated_email         VARCHAR(200),
  activated_password      TEXT,
  activated_link          TEXT,
  activated_pin           VARCHAR(40),
  activated_note          TEXT,
  activated_at            TIMESTAMP,
  activated_by            INTEGER REFERENCES users(id),
  created_at              TIMESTAMP NOT NULL DEFAULT now(),
  updated_at              TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id                     SERIAL PRIMARY KEY,
  rental_id              INTEGER NOT NULL REFERENCES rentals(id),
  payment_method_id      INTEGER NOT NULL REFERENCES payment_methods(id),
  transaction_ref        VARCHAR(160) NOT NULL,
  amount                 INTEGER NOT NULL DEFAULT 0,
  receipt_image_data     TEXT,
  receipt_hash           VARCHAR(128),
  status                 VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | CONFIRMED | REJECTED
  reviewed_by            INTEGER REFERENCES users(id),
  reviewed_at            TIMESTAMP,
  rejection_reason       TEXT,
  is_extension           BOOLEAN NOT NULL DEFAULT FALSE,
  duration_days          INTEGER NOT NULL DEFAULT 0,
  previous_end_date      TIMESTAMP,
  previous_rental_status VARCHAR(20),
  created_by             INTEGER REFERENCES users(id),
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT payments_method_ref_idx UNIQUE (payment_method_id, transaction_ref)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  username    VARCHAR(80),
  action      VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60),
  entity_id   INTEGER,
  details     TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id          SERIAL PRIMARY KEY,
  rental_id   INTEGER REFERENCES rentals(id),
  customer_id INTEGER REFERENCES customers(id),
  phone       VARCHAR(40) NOT NULL,
  message     TEXT NOT NULL,
  kind        VARCHAR(40) NOT NULL DEFAULT 'EXPIRY_WARNING',
  status      VARCHAR(40) NOT NULL DEFAULT 'QUEUED', -- SENT | QUEUED | SIMULATED | FAILED
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2) COLUMNS (add only if missing) — safe for tables that already exist
-- ---------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS id              SERIAL PRIMARY KEY;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username        VARCHAR(80)  NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash   TEXT         NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name    VARCHAR(120) NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role            VARCHAR(20)  NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active       BOOLEAN      NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at   TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email           VARCHAR(180);
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at      TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE platforms ADD COLUMN IF NOT EXISTS id                      SERIAL PRIMARY KEY;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS name                    VARCHAR(120) NOT NULL;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS color                   VARCHAR(20)  NOT NULL DEFAULT '#0f172a';
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS short_name              VARCHAR(10)  NOT NULL DEFAULT '▶';
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS image_url               TEXT;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS delivery_mode           VARCHAR(20)  NOT NULL DEFAULT 'INVENTORY';
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS requires_customer_email BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS extra_field_label       VARCHAR(200);
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS is_active               BOOLEAN      NOT NULL DEFAULT TRUE;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS created_at              TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS id         SERIAL PRIMARY KEY;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS name       VARCHAR(120) NOT NULL;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS is_active  BOOLEAN      NOT NULL DEFAULT TRUE;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS created_at TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE customers ADD COLUMN IF NOT EXISTS id         SERIAL PRIMARY KEY;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name       VARCHAR(160) NOT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone      VARCHAR(40)  NOT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE settings ADD COLUMN IF NOT EXISTS id         SERIAL PRIMARY KEY;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS key        VARCHAR(120) NOT NULL;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS value      TEXT         NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS id         SERIAL PRIMARY KEY;
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS email      VARCHAR(180) NOT NULL;
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS code_hash  TEXT         NOT NULL;
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP    NOT NULL;
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS used       BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS id                 SERIAL PRIMARY KEY;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS platform_id        INTEGER      NOT NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type               VARCHAR(20)  NOT NULL DEFAULT 'FULL';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_profiles       INTEGER      NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email              VARCHAR(200) NOT NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_encrypted TEXT         NOT NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pin                VARCHAR(40);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS expiry_date        TIMESTAMP    NOT NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status             VARCHAR(40)  NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes              TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sale_price         INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_deleted         BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMP;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_reason     TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at         TIMESTAMP    NOT NULL DEFAULT now();
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id                SERIAL PRIMARY KEY;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS account_id        INTEGER NOT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_no        INTEGER NOT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_name      VARCHAR(80);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin               VARCHAR(40);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_occupied       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_rental_id INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at        TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS id          SERIAL PRIMARY KEY;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title       VARCHAR(200) NOT NULL;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS body        TEXT         NOT NULL;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS kind        VARCHAR(40)  NOT NULL DEFAULT 'INFO';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS href        VARCHAR(200);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS for_user_id INTEGER;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS created_at  TIMESTAMP    NOT NULL DEFAULT now();

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS id         SERIAL PRIMARY KEY;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_id    INTEGER NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS endpoint   TEXT    NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS p256dh     TEXT    NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS auth       TEXT    NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE rentals ADD COLUMN IF NOT EXISTS id                      SERIAL PRIMARY KEY;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS account_id              INTEGER;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS profile_id              INTEGER;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS customer_id             INTEGER NOT NULL;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS platform_id             INTEGER NOT NULL;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS created_by              INTEGER NOT NULL;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS rental_type             VARCHAR(20) NOT NULL DEFAULT 'NEW';
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS start_date              TIMESTAMP NOT NULL;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS end_date                TIMESTAMP NOT NULL;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS duration_days           INTEGER   NOT NULL;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS status                  VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS password_used_encrypted TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS whatsapp_alert_sent     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS whatsapp_alert_sent_at  TIMESTAMP;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS customer_email          VARCHAR(200);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS customer_extra          TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activation_status       VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_email         VARCHAR(200);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_password      TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_link          TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_pin           VARCHAR(40);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_note          TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_at            TIMESTAMP;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_by            INTEGER;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS created_at              TIMESTAMP NOT NULL DEFAULT now();
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE payments ADD COLUMN IF NOT EXISTS id                     SERIAL PRIMARY KEY;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS rental_id              INTEGER NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_id      INTEGER NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_ref        VARCHAR(160) NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount                 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_image_data     TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_hash           VARCHAR(128);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status                 VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_by            INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_at            TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejection_reason       TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_extension           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS duration_days          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_end_date      TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_rental_status VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by             INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at             TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS id          SERIAL PRIMARY KEY;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id     INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username    VARCHAR(80);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action      VARCHAR(80) NOT NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(60);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id   INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details     TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at  TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS id          SERIAL PRIMARY KEY;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS rental_id   INTEGER;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS phone       VARCHAR(40) NOT NULL;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS message     TEXT NOT NULL;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS kind        VARCHAR(40) NOT NULL DEFAULT 'EXPIRY_WARNING';
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS status      VARCHAR(40) NOT NULL DEFAULT 'QUEUED';
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS created_at  TIMESTAMP NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------
-- 3) Relax rentals.account_id to nullable (on-demand orders need NULL)
--    Safe: never removes data; no-op if already nullable.
-- ---------------------------------------------------------------------
ALTER TABLE rentals ALTER COLUMN account_id DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 4) Foreign keys (add only if the constraint is missing) — exception-free
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_platform_id_fkey') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES platforms(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_id_fkey') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alerts_for_user_id_fkey') THEN
    ALTER TABLE alerts ADD CONSTRAINT alerts_for_user_id_fkey FOREIGN KEY (for_user_id) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_fkey') THEN
    ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_account_id_fkey') THEN
    ALTER TABLE rentals ADD CONSTRAINT rentals_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_profile_id_fkey') THEN
    ALTER TABLE rentals ADD CONSTRAINT rentals_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_customer_id_fkey') THEN
    ALTER TABLE rentals ADD CONSTRAINT rentals_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_platform_id_fkey') THEN
    ALTER TABLE rentals ADD CONSTRAINT rentals_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES platforms(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_created_by_fkey') THEN
    ALTER TABLE rentals ADD CONSTRAINT rentals_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_activated_by_fk') THEN
    ALTER TABLE rentals ADD CONSTRAINT rentals_activated_by_fk FOREIGN KEY (activated_by) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_rental_id_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES rentals(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_method_id_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_reviewed_by_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_created_by_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_id_fkey') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_logs_rental_id_fkey') THEN
    ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES rentals(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_logs_customer_id_fkey') THEN
    ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5) Unique constraints (idempotent via CREATE UNIQUE INDEX IF NOT EXISTS)
--    Note: uses an index (functionally identical to a unique constraint).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key              ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS platforms_name_key              ON platforms (name);
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_name_key        ON payment_methods (name);
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_key             ON customers (phone);
CREATE UNIQUE INDEX IF NOT EXISTS settings_key_key                ON settings (key);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key ON push_subscriptions (endpoint);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_account_no_idx         ON profiles (account_id, profile_no);
CREATE UNIQUE INDEX IF NOT EXISTS payments_method_ref_idx         ON payments (payment_method_id, transaction_ref);

-- ---------------------------------------------------------------------
-- 6) Lookup indexes (IF NOT EXISTS)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS accounts_platform_idx ON accounts (platform_id);
CREATE INDEX IF NOT EXISTS accounts_status_idx   ON accounts (status);
CREATE INDEX IF NOT EXISTS rentals_customer_idx  ON rentals (customer_id);
CREATE INDEX IF NOT EXISTS rentals_status_idx    ON rentals (status);
CREATE INDEX IF NOT EXISTS rentals_account_idx   ON rentals (account_id);

-- ---------------------------------------------------------------------
-- 7) Default settings (idempotent — insert only if key absent)
-- ---------------------------------------------------------------------
INSERT INTO settings (key, value) VALUES ('
  whatsapp_expiry_template',
  'مرحباً {{name}} 👋\nتنبيه من متجر مايسترو كي 🔑\nاشتراكك في {{platform}} سينتهي بتاريخ {{end_date}} (بعد {{days}} يوم).\nللتجديد بدون انقطاع، حوّل مبلغ التجديد وأرسل السند هنا وسنمدّد اشتراكك فوراً.\nشكراً لثقتك بنا.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('
  whatsapp_sale_template',
  'مرحباً {{name}} 🎉\nتم تفعيل اشتراك {{platform}} بنجاح من متجر مايسترو كي 🔑\n📧 الإيميل: {{email}}\n🔑 كلمة المرور: {{password}}\n👤 البروفايل/PIN: {{profile}}\n⏳ صالح حتى: {{end_date}}\nمشاهدة سعيدة! لا تشارك البيانات مع أحد.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('
  whatsapp_renewal_template',
  'مرحباً {{name}} ✅\nتم تجديد اشتراك {{platform}} بنجاح حتى {{end_date}}.\nنفس بيانات الدخول السابقة تعمل بدون تغيير.\nمتجر مايسترو كي 🔑'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('
  whatsapp_activation_template',
  'مبروك {{name}} 🎉\nاشتراك {{platform}} تم تفعيله بنجاح من متجر مايسترو كي 🔑\n{{credentials}}\n⏳ صالح حتى: {{end_date}}\nتمتعة سعيدة! إذا احتجت أي مساعدة تواصل معنا.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('store_name', 'متجر مايسترو كي') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('alert_days_before', '2') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('whatsapp_provider', 'WHATSAPP_LINK') ON CONFLICT (key) DO NOTHING;

COMMIT;

-- =====================================================================
--  DONE. All tables/columns/indexes/constraints now match the code.
--  No data was deleted. You can re-run this script safely any time.
-- =====================================================================
