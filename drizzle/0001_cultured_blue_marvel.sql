CREATE TABLE "wallet_balances" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"rental_id" integer,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "payments_method_ref_idx";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "password_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "expiry_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "payment_method_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "delivery_kind" varchar(20) DEFAULT 'CREDENTIALS' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "invite_link" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "license_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "max_uses" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "used_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "delivery_mode" varchar(20) DEFAULT 'INSTANT_INVENTORY' NOT NULL;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "requires_customer_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "extra_field_label" varchar(200);--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "is_lifetime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "low_stock_threshold" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "status" varchar(20) DEFAULT 'AVAILABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "sold_at" timestamp;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "sold_by" integer;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "is_lifetime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "customer_email" varchar(200);--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "customer_extra" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activation_status" varchar(20) DEFAULT 'NOT_REQUIRED' NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activated_email" varchar(200);--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activated_password" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activated_link" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activated_pin" varchar(40);--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activated_note" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "activated_by" integer;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "delivery_source" varchar(20) DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "manual_email" varchar(200);--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "manual_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "manual_link" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "manual_code_encrypted" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "manual_note" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_balance" numeric(12, 2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text;--> statement-breakpoint
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_rental_id_rentals_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_balances_user_idx" ON "wallet_balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_transactions_user_idx" ON "wallet_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_rental_idx" ON "payments" USING btree ("rental_id");--> statement-breakpoint
CREATE INDEX "profiles_available_idx" ON "profiles" USING btree ("account_id","status","id");