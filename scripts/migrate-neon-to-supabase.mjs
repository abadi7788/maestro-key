#!/usr/bin/env node
/**
 * Maestro Key — Lightweight Neon -> Supabase Migration Script
 * -----------------------------------------------------------
 * يسحب البيانات النصية والأرقام فقط من قاعدة Neon القديمة (DATABASE_BACKUP_URL)
 * مع استبعاد الصور الثقيلة (Base64 receipt images) والجداول المؤقتة (email_codes, push_subscriptions)
 * بأقل استهلاك ممكن لبيانات Neon، ثم:
 *   1) يصدّر نسخة JSON مضغوطة (.json.gz) وملف SQL جاهز للاستيراد في Supabase / GitHub
 *   2) وينقل البيانات مباشرة إلى قاعدة Supabase (DATABASE_URL) مع ضبط التسلسلات (SERIAL sequences).
 *
 * أمثلة التشغيل:
 *   node scripts/migrate-neon-to-supabase.mjs --export-only
 *   node scripts/migrate-neon-to-supabase.mjs --clean
 *   DATABASE_BACKUP_URL="..." DATABASE_URL="..." node scripts/migrate-neon-to-supabase.mjs --clean
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { Pool } from "pg";

const gzipAsync = promisify(zlib.gzip);

// تحميل متغيرات .env.local / .env إن وجدت (اختياري)
try {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.local", quiet: true });
  dotenv.config({ path: ".env", quiet: true });
} catch {}

// ترتيب الجداول وفق المفاتيح الخارجية (من الأب إلى الابن)
const TABLES_IN_ORDER = [
  { name: "users", pk: "id", seqCol: "id" },
  { name: "platforms", pk: "id", seqCol: "id" },
  { name: "payment_methods", pk: "id", seqCol: "id" },
  { name: "customers", pk: "id", seqCol: "id" },
  { name: "accounts", pk: "id", seqCol: "id" },
  { name: "profiles", pk: "id", seqCol: "id" },
  { name: "rentals", pk: "id", seqCol: "id" },
  { name: "payments", pk: "id", seqCol: "id" },
  { name: "wallet_balances", pk: "user_id", seqCol: null },
  { name: "wallet_transactions", pk: "id", seqCol: "id" },
  { name: "alerts", pk: "id", seqCol: "id" },
  { name: "audit_logs", pk: "id", seqCol: "id" },
  { name: "settings", pk: "id", seqCol: "id" },
  { name: "whatsapp_logs", pk: "id", seqCol: "id" },
];

// نفس عبارات التهيئة الآمنة لضمان تطابق Supabase قبل النقل
const ENSURE_SCHEMA_STATEMENTS = [
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
  `CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    kind VARCHAR(40) NOT NULL DEFAULT 'INFO',
    href VARCHAR(200),
    for_user_id INTEGER REFERENCES users(id),
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
  `CREATE TABLE IF NOT EXISTS email_codes (
    id SERIAL PRIMARY KEY,
    email VARCHAR(180) NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(180)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) DEFAULT '0.00'`,
  `ALTER TABLE platforms ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 3`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sold_at TIMESTAMP`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sold_by INTEGER REFERENCES users(id)`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP`,
  `ALTER TABLE rentals ADD COLUMN IF NOT EXISTS refund_reason TEXT`,
  `ALTER TABLE payments ALTER COLUMN payment_method_id DROP NOT NULL`,
  `CREATE INDEX IF NOT EXISTS accounts_platform_idx ON accounts(platform_id)`,
  `CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status)`,
  `CREATE INDEX IF NOT EXISTS profiles_available_idx ON profiles(account_id, status, id)`,
  `CREATE INDEX IF NOT EXISTS rentals_customer_idx ON rentals(customer_id)`,
  `CREATE INDEX IF NOT EXISTS rentals_status_idx ON rentals(status)`,
  `CREATE INDEX IF NOT EXISTS rentals_account_idx ON rentals(account_id)`,
  `CREATE INDEX IF NOT EXISTS payments_rental_idx ON payments(rental_id)`,
  `CREATE INDEX IF NOT EXISTS wallet_balances_user_idx ON wallet_balances(user_id)`,
  `CREATE INDEX IF NOT EXISTS wallet_transactions_user_idx ON wallet_transactions(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS wallet_transactions_rental_idx ON wallet_transactions(rental_id)`,
];

function buildPgPool(rawUrl) {
  let connectionString = rawUrl.trim();
  let disableSsl = false;
  let isLocalhost = false;

  try {
    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode === "disable") {
      disableSsl = true;
    } else if (sslMode) {
      parsed.searchParams.delete("sslmode");
      connectionString = parsed.toString();
    }
    isLocalhost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  } catch {}

  const cfg = {
    connectionString,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 20000,
    allowExitOnIdle: true,
  };

  if (!disableSsl && (!isLocalhost || rawUrl.includes("sslmode=") || rawUrl.includes("supabase") || rawUrl.includes("neon.tech"))) {
    cfg.ssl = { rejectUnauthorized: false };
  }

  return new Pool(cfg);
}

function sqlLiteral(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "NULL";
  if (val instanceof Date) return `'${val.toISOString().replace(/'/g, "''")}'::timestamptz`;
  if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function getTableColumns(pool, tableName) {
  const res = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return res.rows.map((r) => r.column_name);
}

async function extractLightDataFromSource(sourcePool) {
  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: "neon-lightweight",
    strippedFields: ["payments.receipt_image_data (data:* base64)", "email_codes", "push_subscriptions"],
    tables: {},
    counts: {},
  };

  let strippedImages = 0;

  for (const tbl of TABLES_IN_ORDER) {
    const cols = await getTableColumns(sourcePool, tbl.name);
    if (cols.length === 0) {
      console.log(`  - تخطي جدول ${tbl.name} (غير موجود في القاعدة المصدر)`);
      snapshot.tables[tbl.name] = [];
      snapshot.counts[tbl.name] = 0;
      continue;
    }

    // استبدال صور Base64 الثقيلة في payments بـ NULL وتجاهل الصور الضخمة غير النصية
    const selectExprs = cols.map((col) => {
      if (tbl.name === "payments" && col === "receipt_image_data") {
        return `CASE WHEN "receipt_image_data" LIKE 'data:%' THEN NULL ELSE "receipt_image_data" END AS "receipt_image_data"`;
      }
      return `"${col}"`;
    });

    if (tbl.name === "payments" && cols.includes("receipt_image_data")) {
      const stat = await sourcePool.query(
        `SELECT COUNT(*)::int AS cnt FROM "payments" WHERE "receipt_image_data" LIKE 'data:%'`
      );
      strippedImages = stat.rows[0]?.cnt || 0;
    }

    const orderCol = cols.includes(tbl.pk) ? ` ORDER BY "${tbl.pk}" ASC` : "";
    const dataRes = await sourcePool.query(`SELECT ${selectExprs.join(", ")} FROM "${tbl.name}"${orderCol}`);

    // تطبيع التواريخ إلى ISO Strings
    const rows = dataRes.rows.map((row) => {
      const out = {};
      for (const c of cols) {
        const v = row[c];
        out[c] = v instanceof Date ? v.toISOString() : v;
      }
      return out;
    });

    snapshot.tables[tbl.name] = rows;
    snapshot.counts[tbl.name] = rows.length;
    console.log(`  ✓ ${tbl.name}: ${rows.length} صف`);
  }

  console.log(`  ℹ تم استبعاد ${strippedImages} صورة سند (Base64) لتوفير حصة النقل.`);
  return snapshot;
}

function buildSqlDump(snapshot) {
  const lines = [
    "-- Maestro Key Lightweight Data Export (Text & Numbers Only — No Heavy Receipt Images)",
    `-- Exported at: ${snapshot.exportedAt}`,
    "BEGIN;",
    "",
  ];

  for (const tbl of TABLES_IN_ORDER) {
    const rows = snapshot.tables[tbl.name] || [];
    if (rows.length === 0) continue;

    lines.push(`-- Table: ${tbl.name} (${rows.length} rows)`);
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");

    for (const row of rows) {
      const vals = cols.map((c) => sqlLiteral(row[c])).join(", ");
      lines.push(`INSERT INTO "${tbl.name}" (${colList}) VALUES (${vals}) ON CONFLICT DO NOTHING;`);
    }

    if (tbl.seqCol) {
      lines.push(
        `SELECT setval(pg_get_serial_sequence('${tbl.name}', '${tbl.seqCol}'), COALESCE((SELECT MAX("${tbl.seqCol}") FROM "${tbl.name}"), 1), (SELECT COUNT(*) > 0 FROM "${tbl.name}"));`
      );
    }
    lines.push("");
  }

  lines.push("COMMIT;");
  return lines.join("\n");
}

async function ensureTargetSchema(client) {
  for (const sql of ENSURE_SCHEMA_STATEMENTS) {
    try {
      await client.query(sql);
    } catch (e) {
      // تجاهل الأخطاء غير الحرجة في ترخية/إنشاء الفهارس إذا وجدت مسبقاً
      console.warn(`  [schema warn] ${e.message}`);
    }
  }
}

async function importIntoTarget(targetPool, snapshot, cleanMode) {
  const client = await targetPool.connect();
  try {
    console.log("\n[Supabase] التحقق من هيكل الجداول في القاعدة المستهدفة...");
    await ensureTargetSchema(client);

    await client.query("BEGIN");

    if (cleanMode) {
      const reverseNames = [...TABLES_IN_ORDER].reverse().map((t) => `"${t.name}"`);
      console.log("[Supabase] --clean مفعّل: تفريغ الجداول المستهدفة قبل الاستيراد للحفاظ على مطابقة IDs...");
      await client.query(`TRUNCATE TABLE ${reverseNames.join(", ")} RESTART IDENTITY CASCADE`);
    }

    for (const tbl of TABLES_IN_ORDER) {
      const rows = snapshot.tables[tbl.name] || [];
      if (rows.length === 0) continue;

      const targetCols = await getTableColumns(client, tbl.name);
      const sourceCols = Object.keys(rows[0]);
      const cols = sourceCols.filter((c) => targetCols.includes(c));
      if (cols.length === 0) continue;

      const chunkSize = 150;
      let insertedTotal = 0;

      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = [];
        const placeholders = chunk.map((row, rIdx) => {
          const rowPh = cols.map((col, cIdx) => {
            values.push(row[col] === undefined ? null : row[col]);
            return `$${rIdx * cols.length + cIdx + 1}`;
          });
          return `(${rowPh.join(", ")})`;
        });

        const sql = `INSERT INTO "${tbl.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`;
        const res = await client.query(sql, values);
        insertedTotal += res.rowCount || 0;
      }

      if (tbl.seqCol) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX("${tbl.seqCol}") FROM "${tbl.name}"), 1), EXISTS(SELECT 1 FROM "${tbl.name}"))`,
          [tbl.name, tbl.seqCol]
        );
      }

      console.log(`  ✓ ${tbl.name}: نُقل ${insertedTotal} / ${rows.length} صف`);
    }

    await client.query("COMMIT");
    console.log("\n✅ تم نقل البيانات وضبط التسلسلات (Sequences) إلى Supabase بنجاح.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const exportOnly = args.has("--export-only") || args.has("--export");
  const cleanMode = args.has("--clean");

  const sourceUrl = process.env.DATABASE_BACKUP_URL?.trim();
  const targetUrl = process.env.DATABASE_URL?.trim();

  if (!sourceUrl) {
    throw new Error(
      "يرجى تمرير رابط قاعدة Neon القديمة في المتغير DATABASE_BACKUP_URL.\n" +
      "مثال:\n  DATABASE_BACKUP_URL='postgres://...' DATABASE_URL='postgres://...' node scripts/migrate-neon-to-supabase.mjs --clean"
    );
  }

  console.log("[1/3] الاتصال بقاعدة Neon القديمة لسحب نسخة نصية خفيفة...");
  const sourcePool = buildPgPool(sourceUrl);
  let snapshot;
  try {
    snapshot = await extractLightDataFromSource(sourcePool);
  } finally {
    await sourcePool.end();
  }

  // حفظ الملفات محلياً (JSON مضغوط + SQL جاهز)
  const outDir = path.resolve("backups");
  await fs.mkdir(outDir, { recursive: true, mode: 0o700 });

  const jsonPath = path.join(outDir, "neon-light-export.json.gz");
  const sqlPath = path.join(outDir, "neon-light-export.sql");

  const jsonBuffer = Buffer.from(JSON.stringify(snapshot), "utf8");
  const gzBuffer = await gzipAsync(jsonBuffer, { level: 9 });
  await fs.writeFile(jsonPath, gzBuffer, { mode: 0o600 });

  const sqlDump = buildSqlDump(snapshot);
  await fs.writeFile(sqlPath, sqlDump, { mode: 0o600 });

  console.log(`\n[2/3] تم حفظ ملفات التصدير الخفيفة:`);
  console.log(`  • ${path.relative(process.cwd(), jsonPath)} (${(gzBuffer.length / 1024).toFixed(1)} KB مضغوط)`);
  console.log(`  • ${path.relative(process.cwd(), sqlPath)} (${(Buffer.byteLength(sqlDump) / 1024).toFixed(1)} KB SQL)`);

  if (exportOnly) {
    console.log("\nتم اختيار --export-only. يمكنك استيراد ملف SQL مباشرة في Supabase أو تشغيل السكربت مع DATABASE_URL.");
    return;
  }

  if (!targetUrl) {
    console.log("\n[3/3] لم يتم تمرير DATABASE_URL (Supabase)، لذا اكتفى السكربت بالتصدير فقط.");
    return;
  }

  if (targetUrl === sourceUrl) {
    throw new Error("DATABASE_URL و DATABASE_BACKUP_URL متطابقان! أوقفت العملية لمنع مسح المصدر بالخطأ.");
  }

  console.log("\n[3/3] استيراد النسخة الخفيفة إلى Supabase (DATABASE_URL)...");
  const targetPool = buildPgPool(targetUrl);
  try {
    await importIntoTarget(targetPool, snapshot, cleanMode);
  } finally {
    await targetPool.end();
  }
}

main().catch((err) => {
  console.error("\n❌ فشلت عملية الترحيل:", err?.message || err);
  process.exitCode = 1;
});
