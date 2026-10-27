-- =====================================================================
--  Maestro Key — Migration: Optional fields + Dynamic Delivery Types
--  Safe & idempotent. NO data is deleted. Re-runnable.
--
--  Changes:
--   1) accounts: email, password_encrypted, expiry_date become NULLABLE
--      (was NOT NULL). Safe: relaxing a constraint never touches data.
--   2) accounts: new columns delivery_type (default 'CREDENTIALS'),
--      invite_link, invite_max_uses, license_key.
--   3) rentals: new column activated_license_key (nullable).
--
--  Run in Neon SQL Editor. Safe to run multiple times.
-- =====================================================================

BEGIN;

-- 1) Relax NOT NULL on account credential/expiry fields (existing rows keep values)
ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN password_encrypted DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN expiry_date DROP NOT NULL;

-- 2) New delivery-type columns on accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS delivery_type    varchar(20) NOT NULL DEFAULT 'CREDENTIALS';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS invite_link      text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS invite_max_uses  integer;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS license_key      text;

-- 3) New column on rentals for license-key delivery
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS activated_license_key text;

COMMIT;

-- =====================================================================
--  DONE. Existing data is untouched. Existing accounts default to
--  delivery_type = 'CREDENTIALS' (their email/password remain as-is).
-- =====================================================================
