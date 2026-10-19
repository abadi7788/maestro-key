import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const folder = path.join(root, "drizzle");
const journal = JSON.parse(await fs.readFile(path.join(folder, "meta", "_journal.json"), "utf8"));
const migrations = await Promise.all(journal.entries.map(async (entry) => {
  if (!/^[a-zA-Z0-9_]+$/.test(entry.tag) || !Number.isSafeInteger(entry.when)) {
    throw new Error("Unexpected migration metadata.");
  }
  const original = await fs.readFile(path.join(folder, `${entry.tag}.sql`), "utf8");
  return {
    ...entry,
    hash: createHash("sha256").update(original).digest("hex"),
    ddl: original.replaceAll("--> statement-breakpoint", "\n"),
  };
}));
if (!migrations.length) throw new Error("No versioned migrations were found.");
const tables = [...new Set(migrations.flatMap((migration) =>
  [...migration.ddl.matchAll(/CREATE TABLE\s+"(\w+)"/g)].map((match) => match[1])
))].sort();
const list = tables.map((name) => `'${name}'`).join(", ");
const sql = `-- Maestro Key — مخطط قاعدة البيانات لـ Neon / PostgreSQL
-- شغّل هذا الملف كاملاً في SQL Editor على قاعدة متجر جديدة وفارغة فقط.
-- يحتوي ${tables.length} جدولاً مع علاقاتها وفهارسها. لا يحتوي أسراراً أو بيانات تجريبية.
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
    AND table_name IN (${list});

  IF existing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Maestro Key tables already exist: %. Use an empty database; no existing data was changed.', existing_tables;
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'A Drizzle migration history already exists. Use normal versioned migrations instead of this first-install file.';
  END IF;
END;
$maestro_schema_guard$;

${migrations.map((migration) => `-- Migration: ${migration.tag}\n${migration.ddl.trim()}`).join("\n\n")}

-- Keep the application migration history in sync. This is metadata, not store data.
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE "drizzle"."__drizzle_migrations" (
  "id" serial PRIMARY KEY,
  "hash" text NOT NULL,
  "created_at" bigint
);
${migrations.map((migration) => `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")\nVALUES ('${migration.hash}', ${migration.when});`).join("\n")}

COMMIT;

-- Success: the following result should show ${tables.length} application tables.
SELECT
  'تم إنشاء جداول مايسترو كي بنجاح' AS message,
  count(*)::integer AS application_tables
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN (${list});
`;
const destination = path.join(root, "public", "downloads", "maestro-key-neon-schema.sql");
if (process.argv.includes("--check")) {
  if (await fs.readFile(destination, "utf8") !== sql) throw new Error("Neon SQL export is out of date. Run node scripts/export-neon-schema.mjs.");
  console.log(`PASS Neon SQL matches ${tables.length} application tables and ${migrations.length} versioned migration(s).`);
} else {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, sql, "utf8");
  console.log(`Created public/downloads/maestro-key-neon-schema.sql — ${tables.length} tables; no credentials or store records.`);
}
