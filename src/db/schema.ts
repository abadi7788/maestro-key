import {
  pgTable, serial, text, varchar, integer, boolean, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 80 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("EMPLOYEE"), // ADMIN | EMPLOYEE
  isActive: boolean("is_active").notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  lastLoginAt: timestamp("last_login_at"),
  email: varchar("email", { length: 180 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const platforms = pgTable("platforms", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  color: varchar("color", { length: 20 }).notNull().default("#0f172a"),
  shortName: varchar("short_name", { length: 10 }).notNull().default("▶"),
  imageUrl: text("image_url"),
  // INVENTORY = من المخزون (تسليم فوري) | ON_DEMAND = عند الطلب (المدير يفعّل)
  deliveryMode: varchar("delivery_mode", { length: 20 }).notNull().default("INVENTORY"),
  requiresCustomerEmail: boolean("requires_customer_email").notNull().default(false),
  extraFieldLabel: varchar("extra_field_label", { length: 200 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  kind: varchar("kind", { length: 40 }).notNull().default("INFO"),
  href: varchar("href", { length: 200 }),
  forUserId: integer("for_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const emailCodes = pgTable("email_codes", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 180 }).notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id").notNull().references(() => platforms.id),
  type: varchar("type", { length: 20 }).notNull().default("FULL"), // FULL | PROFILE
  maxProfiles: integer("max_profiles").notNull().default(1),
  email: varchar("email", { length: 200 }).notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  pin: varchar("pin", { length: 40 }),
  expiryDate: timestamp("expiry_date").notNull(),
  // AVAILABLE | RENTED | NEEDS_PASSWORD_CHANGE
  status: varchar("status", { length: 40 }).notNull().default("AVAILABLE"),
  notes: text("notes"),
  salePrice: integer("sale_price"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  deletedReason: text("deleted_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("accounts_platform_idx").on(t.platformId), index("accounts_status_idx").on(t.status)]);

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  profileNo: integer("profile_no").notNull(),
  profileName: varchar("profile_name", { length: 80 }),
  pin: varchar("pin", { length: 40 }),
  isOccupied: boolean("is_occupied").notNull().default(false),
  currentRentalId: integer("current_rental_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("profiles_account_no_idx").on(t.accountId, t.profileNo)]);

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull().unique(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const rentals = pgTable("rentals", {
  id: serial("id").primaryKey(),
  // nullable: طلبات "عند الطلب" لا ترتبط بحساب مخزون حتى يُفعّل
  accountId: integer("account_id").references(() => accounts.id),
  profileId: integer("profile_id").references(() => profiles.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  platformId: integer("platform_id").notNull().references(() => platforms.id),
  createdBy: integer("created_by").notNull().references(() => users.id),
  rentalType: varchar("rental_type", { length: 20 }).notNull().default("NEW"), // NEW | RENEWAL
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  durationDays: integer("duration_days").notNull(),
  // ACTIVE | ENDED | CLOSED | REJECTED
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  passwordUsedEncrypted: text("password_used_encrypted"),
  whatsappAlertSent: boolean("whatsapp_alert_sent").notNull().default(false),
  whatsappAlertSentAt: timestamp("whatsapp_alert_sent_at"),
  // بيانات إضافية من العميل للتفعيل (إيميل/حقل مخصص)
  customerEmail: varchar("customer_email", { length: 200 }),
  customerExtra: text("customer_extra"),
  // NOT_REQUIRED | PENDING | ACTIVATED
  activationStatus: varchar("activation_status", { length: 20 }).notNull().default("NOT_REQUIRED"),
  // بيانات التسليم التي يدخلها المدير عند "تم التفعيل"
  activatedEmail: varchar("activated_email", { length: 200 }),
  activatedPassword: text("activated_password"),
  activatedLink: text("activated_link"),
  activatedPin: varchar("activated_pin", { length: 40 }),
  activatedNote: text("activated_note"),
  activatedAt: timestamp("activated_at"),
  activatedBy: integer("activated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("rentals_customer_idx").on(t.customerId), index("rentals_status_idx").on(t.status), index("rentals_account_idx").on(t.accountId)]);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  rentalId: integer("rental_id").notNull().references(() => rentals.id),
  paymentMethodId: integer("payment_method_id").notNull().references(() => paymentMethods.id),
  transactionRef: varchar("transaction_ref", { length: 160 }).notNull(),
  amount: integer("amount").notNull().default(0),
  receiptImageData: text("receipt_image_data"),
  receiptHash: varchar("receipt_hash", { length: 128 }),
  // PENDING | CONFIRMED | REJECTED
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  isExtension: boolean("is_extension").notNull().default(false),
  durationDays: integer("duration_days").notNull().default(0),
  previousEndDate: timestamp("previous_end_date"),
  previousRentalStatus: varchar("previous_rental_status", { length: 20 }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("payments_method_ref_idx").on(t.paymentMethodId, t.transactionRef)]);

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  username: varchar("username", { length: 80 }),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entity_type", { length: 60 }),
  entityId: integer("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 120 }).notNull().unique(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappLogs = pgTable("whatsapp_logs", {
  id: serial("id").primaryKey(),
  rentalId: integer("rental_id").references(() => rentals.id),
  customerId: integer("customer_id").references(() => customers.id),
  phone: varchar("phone", { length: 40 }).notNull(),
  message: text("message").notNull(),
  kind: varchar("kind", { length: 40 }).notNull().default("EXPIRY_WARNING"),
  status: varchar("status", { length: 40 }).notNull().default("QUEUED"), // SENT | QUEUED | SIMULATED | FAILED
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
