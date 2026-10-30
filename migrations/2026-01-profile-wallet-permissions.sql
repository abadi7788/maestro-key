-- ============================================================
-- Maestro Key — Migration 2026-01
-- تصحيح فرز البروفايلات + محفظة مايسترو كي + الصلاحيات
--  • آمن تماماً على البيانات الحالية (بدون حذف أو تصفير)
--  • قابلة للتشغيل أكثر من مرة (idempotent)
-- ============================================================

BEGIN;

-- ============================================================
-- 1) البروفايلات: حالة صارمة + مزامنة حالة بسيطة
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE';

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMP;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sold_by INTEGER REFERENCES users(id);

-- حالة مصدرية للتوافق مع البيانات القديمة: المشغول = مباع
UPDATE profiles SET status = 'SOLD', sold_at = created_at WHERE is_occupied = true;
UPDATE profiles SET status = 'AVAILABLE' WHERE is_occupied = false;

-- فهرس البحث المفضل (متاحة + ترتيب id)
CREATE INDEX IF NOT EXISTS profiles_available_idx ON profiles(account_id, status, id);

-- ============================================================
-- 2) محفظة مايسترو كي للموظفين والموزعين (RYE / YER)
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wallet_balance INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payments
  ALTER COLUMN payment_method_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL, -- TOPUP | PURCHASE | REFUND | DEDUCT
  amount INTEGER NOT NULL CHECK (amount > 0),
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  rental_id INTEGER REFERENCES rentals(id),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_balance_check CHECK (balance_after >= 0)
);

CREATE INDEX IF NOT EXISTS wallet_balances_user_idx ON wallet_balances(user_id);
CREATE INDEX IF NOT EXISTS wallet_transactions_user_idx ON wallet_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS wallet_transactions_rental_idx ON wallet_transactions(rental_id);

-- ============================================================
-- 3) الصلاحيات اليدوية للمستخدمين
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}';

-- ============================================================
-- 4) حقل الإرجاع (لإلغاء الطلبات وإرجاع الرصيد للمحفظة)
-- ============================================================
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS refund_reason TEXT;

-- ============================================================
-- 5) إشعار انخفاض المخزون
-- ============================================================
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 3;

-- ============================================================
-- 6) تحقق سلامة (قراءة فقط — لا يعدّل)
-- ============================================================
SELECT
  'profiles' AS t,
  count(*) FILTER (WHERE status = 'AVAILABLE') AS available,
  count(*) FILTER (WHERE status = 'SOLD') AS sold,
  count(*) AS total
FROM profiles;

SELECT 'wallet' AS t, count(*) AS rows_count FROM wallet_balances;
SELECT 'wallet_tx' AS t, count(*) AS rows_count FROM wallet_transactions;

COMMIT;
