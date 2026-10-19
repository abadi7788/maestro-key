-- Maestro Key — مخطط قاعدة البيانات لـ Neon / PostgreSQL
-- شغّل هذا الملف كاملاً في SQL Editor على قاعدة متجر جديدة وفارغة فقط.
-- يحتوي 14 جدولاً مع علاقاتها وفهارسها. لا يحتوي أسراراً أو بيانات تجريبية.
-- يتوقف بأمان إذا وُجدت جداول للمتجر؛ لا يحذف أو يفرغ أي بيانات.
-- يسجل ترحيلات Drizzle حتى لا تعاد محاولة إنشاء الجداول عند نشر التطبيق.
-- المصدر: src/db/schema.ts + drizzle/*.sql

BEGIN;
SET LOCAL search_path TO public;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(683912042);

DO $maestro_schema_guard$
DECLARE
  existing_tables text;
BEGIN
  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO existing_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name IN ('accounts', 'alerts', 'audit_logs', 'customers', 'email_codes', 'payment_methods', 'payments', 'platforms', 'profiles', 'push_subscriptions', 'rentals', 'settings', 'users', 'whatsapp_logs');

  IF existing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Maestro Key tables already exist: %. Use an empty database; no existing data was changed.', existing_tables;
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'A Drizzle migration history already exists. Use normal versioned migrations instead of this first-install file.';
  END IF;
END;
$maestro_schema_guard$;

-- Migration: 0000_initial_store
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform_id" integer NOT NULL,
	"type" varchar(20) DEFAULT 'FULL' NOT NULL,
	"max_profiles" integer DEFAULT 1 NOT NULL,
	"email" varchar(200) NOT NULL,
	"password_encrypted" text NOT NULL,
	"pin" varchar(40),
	"expiry_date" timestamp NOT NULL,
	"status" varchar(40) DEFAULT 'AVAILABLE' NOT NULL,
	"notes" text,
	"sale_price" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"deleted_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);


CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"kind" varchar(40) DEFAULT 'INFO' NOT NULL,
	"href" varchar(200),
	"for_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);


CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(80),
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(60),
	"entity_id" integer,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);


CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);


CREATE TABLE "email_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(180) NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);


CREATE TABLE "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_name_unique" UNIQUE("name")
);


CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"rental_id" integer NOT NULL,
	"payment_method_id" integer NOT NULL,
	"transaction_ref" varchar(160) NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"receipt_image_data" text,
	"receipt_hash" varchar(128),
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"is_extension" boolean DEFAULT false NOT NULL,
	"duration_days" integer DEFAULT 0 NOT NULL,
	"previous_end_date" timestamp,
	"previous_rental_status" varchar(20),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);


CREATE TABLE "platforms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"color" varchar(20) DEFAULT '#0f172a' NOT NULL,
	"short_name" varchar(10) DEFAULT '▶' NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platforms_name_unique" UNIQUE("name")
);


CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"profile_no" integer NOT NULL,
	"profile_name" varchar(80),
	"pin" varchar(40),
	"is_occupied" boolean DEFAULT false NOT NULL,
	"current_rental_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);


CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);


CREATE TABLE "rentals" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"profile_id" integer,
	"customer_id" integer NOT NULL,
	"platform_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"rental_type" varchar(20) DEFAULT 'NEW' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"duration_days" integer NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"password_used_encrypted" text,
	"whatsapp_alert_sent" boolean DEFAULT false NOT NULL,
	"whatsapp_alert_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);


CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(120) NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);


CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(80) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"role" varchar(20) DEFAULT 'EMPLOYEE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"last_login_at" timestamp,
	"email" varchar(180),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);


CREATE TABLE "whatsapp_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rental_id" integer,
	"customer_id" integer,
	"phone" varchar(40) NOT NULL,
	"message" text NOT NULL,
	"kind" varchar(40) DEFAULT 'EXPIRY_WARNING' NOT NULL,
	"status" varchar(40) DEFAULT 'QUEUED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);


ALTER TABLE "accounts" ADD CONSTRAINT "accounts_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_for_user_id_users_id_fk" FOREIGN KEY ("for_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payments" ADD CONSTRAINT "payments_rental_id_rentals_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_rental_id_rentals_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "accounts_platform_idx" ON "accounts" USING btree ("platform_id");

CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");

CREATE UNIQUE INDEX "payments_method_ref_idx" ON "payments" USING btree ("payment_method_id","transaction_ref");

CREATE UNIQUE INDEX "profiles_account_no_idx" ON "profiles" USING btree ("account_id","profile_no");

CREATE INDEX "rentals_customer_idx" ON "rentals" USING btree ("customer_id");

CREATE INDEX "rentals_status_idx" ON "rentals" USING btree ("status");

CREATE INDEX "rentals_account_idx" ON "rentals" USING btree ("account_id");

-- Keep the application migration history in sync. This is metadata, not store data.
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE "drizzle"."__drizzle_migrations" (
  "id" serial PRIMARY KEY,
  "hash" text NOT NULL,
  "created_at" bigint
);
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
VALUES ('81f05fc9ab8ec85e54acbbe5a897fb4c46dab0944fc09f28a771a9a3192ab45f', 1792371384826);

COMMIT;

-- Success: the following result should show 14 application tables.
SELECT
  'تم إنشاء جداول مايسترو كي بنجاح' AS message,
  count(*)::integer AS application_tables
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('accounts', 'alerts', 'audit_logs', 'customers', 'email_codes', 'payment_methods', 'payments', 'platforms', 'profiles', 'push_subscriptions', 'rentals', 'settings', 'users', 'whatsapp_logs');
