import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";

loadEnvConfig(process.cwd());

async function main() {
  const [{ db, pool }, schema] = await Promise.all([import("../src/db"), import("../src/db/schema")]);
  const filename = "public/downloads/maestro-key-neon-schema.sql";
  const exported = await fs.readFile(filename, "utf8");
  const migrationSql = await fs.readFile("drizzle/0000_initial_store.sql", "utf8");
  const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
  const expectedTables = [...migrationSql.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]).sort();
  const expectedForeignKeys = [...migrationSql.matchAll(/ADD CONSTRAINT[^\n]+FOREIGN KEY/g)].length;
  const expectedIndexes = [...migrationSql.matchAll(/CREATE (?:UNIQUE )?INDEX "(\w+)"/g)].map((match) => match[1]);
  const migrationTime = JSON.parse(await fs.readFile("drizzle/meta/_journal.json", "utf8")).entries[0].when;
  const name = `mk_neon_test_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const sourceCounts = async () => (await db.execute(sql`select
    (select count(*)::int from public.users) as users,
    (select count(*)::int from public.accounts) as accounts,
    (select count(*)::int from public.customers) as customers,
    (select count(*)::int from public.rentals) as rentals,
    (select count(*)::int from public.payments) as payments`)).rows;
  const before = await sourceCounts();
  let created = false;
  let testPool: Pool | undefined;
  let client: PoolClient | undefined;
  try {
    await db.execute(sql`create database ${sql.identifier(name)}`);
    created = true;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    testPool = new Pool({ connectionString: url.toString(), max: 1 });
    client = await testPool.connect();
    const test = drizzle(client);
    await test.execute(sql.raw(exported));
    const found = await test.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`);
    assert.deepEqual(found.rows.map((row) => row.table_name), expectedTables);
    for (const table of expectedTables) {
      const result = await test.execute<{ count: number }>(sql`select count(*)::int as count from ${sql.identifier("public")}.${sql.identifier(table)}`);
      assert.equal(result.rows[0].count, 0, `${table} should contain no demo or real records`);
    }
    const foreignKeys = await test.execute<{ count: number }>(sql`select count(*)::int as count from pg_constraint where contype='f' and connamespace='public'::regnamespace`);
    assert.equal(foreignKeys.rows[0].count, expectedForeignKeys);
    const indexes = await test.execute<{ indexname: string }>(sql`select indexname from pg_indexes where schemaname='public'`);
    assert.ok(expectedIndexes.every((index) => indexes.rows.some((row) => row.indexname === index)));
    console.log(`PASS fresh SQL creates exactly ${expectedTables.length} empty application tables, ${expectedForeignKeys} foreign keys and all schema indexes.`);

    const [user] = await test.insert(schema.users).values({ username: "neon_schema_test", passwordHash: "test-only-not-a-login", displayName: "Schema test", role: "ADMIN" }).returning();
    const [platform] = await test.insert(schema.platforms).values({ name: "Schema Test Platform" }).returning();
    const [account] = await test.insert(schema.accounts).values({ platformId: platform.id, type: "PROFILE", maxProfiles: 2, email: "schema-test@example.invalid", passwordEncrypted: "test-only-not-an-account-password", expiryDate: new Date(Date.now() + 86400000 * 365), salePrice: 100 }).returning();
    const [profile] = await test.insert(schema.profiles).values({ accountId: account.id, profileNo: 1 }).returning();
    const [customer] = await test.insert(schema.customers).values({ name: "Schema Test", phone: "00000000001" }).returning();
    const [rental] = await test.insert(schema.rentals).values({ accountId: account.id, profileId: profile.id, customerId: customer.id, platformId: platform.id, createdBy: user.id, startDate: new Date(), endDate: new Date(Date.now() + 86400000), durationDays: 1 }).returning();
    const [bank] = await test.insert(schema.paymentMethods).values({ name: "Schema Test Bank" }).returning();
    await test.insert(schema.payments).values({ rentalId: rental.id, paymentMethodId: bank.id, transactionRef: "NEON-SCHEMA-TEST", amount: 100, createdBy: user.id });
    await assert.rejects(() => test.insert(schema.payments).values({ rentalId: rental.id, paymentMethodId: bank.id, transactionRef: "NEON-SCHEMA-TEST", amount: 100 }));
    const [stored] = await test.select().from(schema.accounts).where(eq(schema.accounts.id, account.id));
    assert.equal(stored.salePrice, 100);
    console.log("PASS one-day rentals, suggested prices, references and unique bank/transaction constraints.");

    await assert.rejects(() => test.execute(sql.raw(exported)), (error: unknown) => {
      const failure = error as { message?: string; cause?: { message?: string } };
      return (failure.cause?.message || failure.message || "").includes("Maestro Key tables already exist");
    });
    await test.execute(sql`rollback`);
    const protectedPayment = await test.select().from(schema.payments);
    assert.equal(protectedPayment.length, 1);
    console.log("PASS rerunning first-install SQL is refused without changing existing data.");

    await migrate(test, { migrationsFolder: "./drizzle" });
    const history = await test.execute<{ hash: string; created_at: string }>(sql`select hash, created_at from drizzle.__drizzle_migrations order by id`);
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].hash, migrationHash);
    assert.equal(Number(history.rows[0].created_at), migrationTime);
    assert.equal((await test.select().from(schema.payments)).length, 1);
    console.log("PASS Drizzle recognizes the installed schema and does not repeat the initial migration.");
    assert.deepEqual(await sourceCounts(), before);
    console.log("PASS real store tables and records are unchanged.");
  } finally {
    client?.release();
    if (testPool) await testPool.end();
    if (created) await db.execute(sql`drop database ${sql.identifier(name)} with (force)`);
    await pool.end();
  }
  console.log("Isolated test database removed.");
}

main().catch((error) => { console.error(error.message || "Schema verification failed."); process.exitCode = 1; });
