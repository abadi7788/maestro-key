-- ============================================================
--  Maestro Key — مخطط قاعدة البيانات (PostgreSQL / Neon)
--  انسخ هذا الكود بالكامل والصقه في Neon SQL Editor ثم شغّله.
--  ⚠️ أوامر DROP في الأعلى لمسح الجداول القديمة إن وُجدت (مناسب لقاعدة جديدة).
--  بعد إنشاء الجداول، التطبيق يضيف تلقائياً: المدير، المنصات، البنوك، والإعدادات.
-- ============================================================

BEGIN;

-- ---------- 1) حذف الجداول القديمة إن وُجدت ----------
DROP TABLE IF EXISTS whatsapp_logs CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS rentals CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS email_codes CASCADE;
DROP TABLE IF EXISTS push_subscriptions CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS platforms CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ---------- 2) المستخدمون ----------
CREATE TABLE users (
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

-- ---------- 3) المنصات ----------
CREATE TABLE platforms (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE,
  color       VARCHAR(20)  NOT NULL DEFAULT '#0f172a',
  short_name  VARCHAR(10)  NOT NULL DEFAULT '▶',
  image_url   TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------- 4) الإشعارات ----------
CREATE TABLE alerts (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  body        TEXT         NOT NULL,
  kind        VARCHAR(40)  NOT NULL DEFAULT 'INFO',
  href        VARCHAR(200),
  for_user_id INTEGER REFERENCES users(id),
  created_at  TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------- 5) اشتراكات إشعارات الويب (Push) ----------
CREATE TABLE push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------- 6) أكواد الدخول عبر البريد ----------
CREATE TABLE email_codes (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(180) NOT NULL,
  code_hash   TEXT         NOT NULL,
  expires_at  TIMESTAMP    NOT NULL,
  used        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------- 7) البنوك / وسائل الدفع ----------
CREATE TABLE payment_methods (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------- 8) حسابات المخزون ----------
CREATE TABLE accounts (
  id                   SERIAL PRIMARY KEY,
  platform_id          INTEGER NOT NULL REFERENCES platforms(id),
  type                 VARCHAR(20) NOT NULL DEFAULT 'FULL',   -- FULL | PROFILE
  max_profiles         INTEGER NOT NULL DEFAULT 1,
  email                VARCHAR(200) NOT NULL,
  password_encrypted   TEXT NOT NULL,
  pin                  VARCHAR(40),
  expiry_date          TIMESTAMP NOT NULL,
  status               VARCHAR(40) NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE | RENTED | NEEDS_PASSWORD_CHANGE
  notes                TEXT,
  sale_price           INTEGER,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at           TIMESTAMP,
  deleted_reason       TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX accounts_platform_idx ON accounts(platform_id);
CREATE INDEX accounts_status_idx   ON accounts(status);

-- ---------- 9) البروفايلات (لحسابات PROFILE) ----------
CREATE TABLE profiles (
  id                  SERIAL PRIMARY KEY,
  account_id          INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_no          INTEGER NOT NULL,
  profile_name        VARCHAR(80),
  pin                 VARCHAR(40),
  is_occupied         BOOLEAN NOT NULL DEFAULT FALSE,
  current_rental_id   INTEGER,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT profiles_account_no_idx UNIQUE (account_id, profile_no)
);

-- ---------- 10) العملاء ----------
CREATE TABLE customers (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  phone      VARCHAR(40)  NOT NULL UNIQUE,
  notes      TEXT,
  created_at TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------- 11) الإيجارات / الاشتراكات ----------
CREATE TABLE rentals (
  id                     SERIAL PRIMARY KEY,
  account_id             INTEGER NOT NULL REFERENCES accounts(id),
  profile_id             INTEGER REFERENCES profiles(id),
  customer_id            INTEGER NOT NULL REFERENCES customers(id),
  platform_id            INTEGER NOT NULL REFERENCES platforms(id),
  created_by             INTEGER NOT NULL REFERENCES users(id),
  rental_type            VARCHAR(20) NOT NULL DEFAULT 'NEW', -- NEW | RENEWAL
  start_date             TIMESTAMP NOT NULL,
  end_date               TIMESTAMP NOT NULL,
  duration_days          INTEGER   NOT NULL,
  status                 VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | ENDED | CLOSED | REJECTED
  password_used_encrypted TEXT,
  whatsapp_alert_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_alert_sent_at TIMESTAMP,
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  updated_at             TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX rentals_customer_idx ON rentals(customer_id);
CREATE INDEX rentals_status_idx   ON rentals(status);
CREATE INDEX rentals_account_idx  ON rentals(account_id);

-- ---------- 12) المدفوعات / السندات ----------
CREATE TABLE payments (
  id                    SERIAL PRIMARY KEY,
  rental_id             INTEGER NOT NULL REFERENCES rentals(id),
  payment_method_id     INTEGER NOT NULL REFERENCES payment_methods(id),
  transaction_ref       VARCHAR(160) NOT NULL,
  amount                INTEGER NOT NULL DEFAULT 0,
  receipt_image_data    TEXT,
  receipt_hash          VARCHAR(128),
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | CONFIRMED | REJECTED
  reviewed_by           INTEGER REFERENCES users(id),
  reviewed_at           TIMESTAMP,
  rejection_reason      TEXT,
  is_extension          BOOLEAN NOT NULL DEFAULT FALSE,
  duration_days         INTEGER NOT NULL DEFAULT 0,
  previous_end_date     TIMESTAMP,
  previous_rental_status VARCHAR(20),
  created_by            INTEGER REFERENCES users(id),
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT payments_method_ref_idx UNIQUE (payment_method_id, transaction_ref)
);

-- ---------- 13) سجل التدقيق ----------
CREATE TABLE audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  username    VARCHAR(80),
  action      VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60),
  entity_id   INTEGER,
  details     TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------- 14) الإعدادات ----------
CREATE TABLE settings (
  id         SERIAL PRIMARY KEY,
  key        VARCHAR(120) NOT NULL UNIQUE,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------- 15) سجل رسائل واتساب ----------
CREATE TABLE whatsapp_logs (
  id          SERIAL PRIMARY KEY,
  rental_id   INTEGER REFERENCES rentals(id),
  customer_id INTEGER REFERENCES customers(id),
  phone       VARCHAR(40) NOT NULL,
  message     TEXT NOT NULL,
  kind        VARCHAR(40) NOT NULL DEFAULT 'EXPIRY_WARNING',
  status      VARCHAR(40) NOT NULL DEFAULT 'QUEUED', -- SENT | QUEUED | SIMULATED | FAILED
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================
--  انتهى. الآن افتح التطبيق لأول مرة وسينشئ تلقائياً:
--  مدير النظام + المنصات + البنوك + الإعدادات.
--  ثم سجّل دخولك كمدير عبر: دخول الأدمن → إرسال كود إلى بريدك.
-- ============================================================
