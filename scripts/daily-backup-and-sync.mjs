#!/usr/bin/env node
/**
 * Maestro Key — Daily Lightweight Backup & Dual Sync Script
 * ---------------------------------------------------------
 * يعمل كل 24 ساعة (عبر GitHub Actions أو محلياً):
 *   1) يسحب نسخة نصية خفيفة (بدون صور Base64) من قاعدة Supabase الأساسية (DATABASE_URL)
 *   2) يضغطها ويحفظها في backups/maestro-key-backup-latest.json.gz
 *   3) يرسل ملف النسخة الاحتياطية مباشرة إلى قناة تيليجرام للأرشفة الدائمة
 *   4) يحدّث قاعدة Neon الاحتياطية الواقفة (DATABASE_BACKUP_URL) مرة واحدة يومياً فقط
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { Pool } from "pg";

const gzipAsync = promisify(zlib.gzip);

try {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.local", quiet: true });
  dotenv.config({ path: ".env", quiet: true });
} catch {}

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

async function getTableColumns(poolOrClient, tableName) {
  const res = await poolOrClient.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return res.rows.map((r) => r.column_name);
}

async function extractLightSnapshotFromPrimary(primaryPool) {
  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: "supabase-primary-lightweight",
    tables: {},
    counts: {},
  };

  for (const tbl of TABLES_IN_ORDER) {
    const cols = await getTableColumns(primaryPool, tbl.name);
    if (cols.length === 0) {
      snapshot.tables[tbl.name] = [];
      snapshot.counts[tbl.name] = 0;
      continue;
    }

    const selectExprs = cols.map((col) => {
      if (tbl.name === "payments" && col === "receipt_image_data") {
        return `CASE WHEN "receipt_image_data" LIKE 'data:%' THEN NULL ELSE "receipt_image_data" END AS "receipt_image_data"`;
      }
      return `"${col}"`;
    });

    const orderCol = cols.includes(tbl.pk) ? ` ORDER BY "${tbl.pk}" ASC` : "";
    const res = await primaryPool.query(`SELECT ${selectExprs.join(", ")} FROM "${tbl.name}"${orderCol}`);

    snapshot.tables[tbl.name] = res.rows.map((row) => {
      const out = {};
      for (const c of cols) {
        const v = row[c];
        out[c] = v instanceof Date ? v.toISOString() : v;
      }
      return out;
    });
    snapshot.counts[tbl.name] = res.rows.length;
    console.log(`  ✓ ${tbl.name}: ${res.rows.length} صف`);
  }

  return snapshot;
}

async function sendBackupToTelegram({ buffer, filename, snapshot }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID?.trim();

  if (!botToken || !chatId) {
    console.warn("[Telegram] تخطي الإرسال: TELEGRAM_BOT_TOKEN أو TELEGRAM_ARCHIVE_CHAT_ID غير مضبوط.");
    return { sent: false, skipped: true };
  }

  const totalRows = Object.values(snapshot.counts).reduce((a, b) => a + b, 0);
  const sizeKb = (buffer.length / 1024).toFixed(1);
  const dateLabel = new Date().toISOString().slice(0, 16).replace("T", " ");

  const caption = [
    `🗄️ <b>نسخة احتياطية يومية — متجر مايسترو كي</b>`,
    `📅 التاريخ: ${dateLabel} UTC`,
    `📦 الحجم المضغوط: <code>${sizeKb} KB</code> (بيانات نصية فقط بدون صور)`,
    `📊 إجمالي السجلات: <b>${totalRows}</b>`,
    `• المستخدمون: ${snapshot.counts.users || 0} | العملاء: ${snapshot.counts.customers || 0}`,
    `• الحسابات: ${snapshot.counts.accounts || 0} | البروفايلات: ${snapshot.counts.profiles || 0}`,
    `• الاشتراكات: ${snapshot.counts.rentals || 0} | المدفوعات: ${snapshot.counts.payments || 0}`,
    `• محافظ: ${snapshot.counts.wallet_balances || 0} | حركات المحفظة: ${snapshot.counts.wallet_transactions || 0}`,
  ].join("\n");

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("document", new Blob([buffer], { type: "application/gzip" }), filename);

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`فشل إرسال النسخة لتيليجرام (${res.status}): ${errText}`);
  }

  console.log(`  ✅ تم إرسال ${filename} (${sizeKb} KB) إلى قناة تيليجرام بنجاح.`);
  return { sent: true };
}

async function sendTelegramNotice(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID?.trim();
  if (!botToken || !chatId) return;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function syncNeonStandby(backupUrl, snapshot) {
  const backupPool = buildPgPool(backupUrl);
  const client = await backupPool.connect();
  try {
    for (const sql of ENSURE_SCHEMA_STATEMENTS) {
      try {
        await client.query(sql);
      } catch {}
    }

    await client.query("BEGIN");

    const reverseNames = [...TABLES_IN_ORDER].reverse().map((t) => `"${t.name}"`);
    await client.query(`TRUNCATE TABLE ${reverseNames.join(", ")} RESTART IDENTITY CASCADE`);

    for (const tbl of TABLES_IN_ORDER) {
      const rows = snapshot.tables[tbl.name] || [];
      if (rows.length === 0) continue;

      const targetCols = await getTableColumns(client, tbl.name);
      const sourceCols = Object.keys(rows[0]);
      const cols = sourceCols.filter((c) => targetCols.includes(c));
      if (cols.length === 0) continue;

      const chunkSize = 150;
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

        await client.query(
          `INSERT INTO "${tbl.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
          values
        );
      }

      if (tbl.seqCol) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX("${tbl.seqCol}") FROM "${tbl.name}"), 1), EXISTS(SELECT 1 FROM "${tbl.name}"))`,
          [tbl.name, tbl.seqCol]
        );
      }
    }

    await client.query("COMMIT");
    console.log("  ✅ تم تحديث قاعدة Neon الاحتياطية الواقفة (Standby Sync) بنجاح.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await backupPool.end();
  }
}

async function main() {
  const primaryUrl = process.env.DATABASE_URL?.trim();
  const backupUrl = process.env.DATABASE_BACKUP_URL?.trim();

  if (!primaryUrl) {
    throw new Error("DATABASE_URL (Supabase) مطلوب لأخذ النسخة الاحتياطية اليومية.");
  }

  console.log("[1/4] سحب نسخة خفيفة (بدون صور) من Supabase...");
  const primaryPool = buildPgPool(primaryUrl);
  let snapshot;
  try {
    snapshot = await extractLightSnapshotFromPrimary(primaryPool);
  } finally {
    await primaryPool.end();
  }

  console.log("\n[2/4] ضغط النسخة وحفظها لرفعها إلى مستودع GitHub الخاص...");
  const outDir = path.resolve("backups");
  await fs.mkdir(outDir, { recursive: true, mode: 0o700 });

  const today = new Date().toISOString().slice(0, 10);
  const latestPath = path.join(outDir, "maestro-key-backup-latest.json.gz");
  const jsonBuffer = Buffer.from(JSON.stringify(snapshot), "utf8");
  const gzBuffer = await gzipAsync(jsonBuffer, { level: 9 });

  await fs.writeFile(latestPath, gzBuffer, { mode: 0o600 });
  console.log(`  ✓ حُفظت النسخة في ${path.relative(process.cwd(), latestPath)} (${(gzBuffer.length / 1024).toFixed(1)} KB)`);

  console.log("\n[3/4] إرسال النسخة الاحتياطية إلى تيليجرام...");
  await sendBackupToTelegram({
    buffer: gzBuffer,
    filename: `maestro-key-backup-${today}.json.gz`,
    snapshot,
  });

  if (backupUrl && backupUrl !== primaryUrl) {
    console.log("\n[4/4] مزامنة قاعدة Neon الاحتياطية الواقفة (مرة واحدة يومياً)...");
    try {
      await syncNeonStandby(backupUrl, snapshot);
    } catch (neonErr) {
      const msg = neonErr?.message || String(neonErr);
      console.warn(`  ⚠️ تعذر تحديث قاعدة Neon الاحتياطية اليوم: ${msg}`);
      await sendTelegramNotice(
        `⚠️ <b>تنبيه المزامنة اليومية (Neon Standby)</b>\nتم حفظ نسخة Supabase وإرسالها لتيليجرام وGitHub، لكن تعذر تحديث قاعدة Neon الاحتياطية:\n<code>${msg.slice(0, 300)}</code>`
      );
    }
  } else {
    console.log("\n[4/4] DATABASE_BACKUP_URL غير مضبوط — تم تخطي مزامنة Neon الاحتياطية.");
  }
}

main().catch((err) => {
  console.error("\n❌ فشل سكربت النسخ الاحتياطي:", err?.message || err);
  process.exitCode = 1;
});
