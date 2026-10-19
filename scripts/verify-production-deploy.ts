import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { sql } from "drizzle-orm";

loadEnvConfig(process.cwd());

function run(label: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? "unavailable"}). No connection strings or credentials were printed.`);
  }
  return result.stdout;
}

async function main() {
  const { db, pool } = await import("../src/db");
  const suffix = `${Date.now()}_${randomBytes(3).toString("hex")}`;
  const names = [`mk_deploy_test_${suffix}`, `mk_restore_test_${suffix}`];
  const created: string[] = [];
  let backup: string | undefined;
  const source = new URL(process.env.DATABASE_URL!);
  const password = randomBytes(24).toString("base64url");
  const baseline = async () => (await db.execute(sql`select
    (select count(*)::int from users) as users,
    (select count(*)::int from accounts) as accounts,
    (select count(*)::int from customers) as customers,
    (select count(*)::int from rentals) as rentals,
    (select count(*)::int from payments) as payments`)).rows;
  const before = await baseline();
  const envFor = (name: string): NodeJS.ProcessEnv => {
    const url = new URL(source);
    url.pathname = `/${name}`;
    return { ...process.env, DATABASE_URL: url.toString(), DATABASE_URL_UNPOOLED: url.toString(), ADMIN_INITIAL_PASSWORD: password, STORE_INITIALIZATION: "create", NODE_ENV: "production" };
  };
  const migrate = (env: NodeJS.ProcessEnv) => run("Drizzle migration", "npx", ["--no-install", "drizzle-kit", "migrate", "--config=drizzle.production.config.ts"], env);
  const inspect = (env: NodeJS.ProcessEnv) => {
    const output = run("Store assertions", "npx", ["--no-install", "tsx", "-e", `
      import { db, pool } from "./src/db";
      import { users, platforms, paymentMethods, accounts, customers, rentals, payments } from "./src/db/schema";
      import bcrypt from "bcryptjs";
      (async () => {
        try {
          const u=await db.select().from(users);
          const counts={users:u.length,platforms:(await db.select().from(platforms)).length,banks:(await db.select().from(paymentMethods)).length,accounts:(await db.select().from(accounts)).length,customers:(await db.select().from(customers)).length,rentals:(await db.select().from(rentals)).length,payments:(await db.select().from(payments)).length};
          console.log(JSON.stringify({...counts,validOriginalPassword:u[0]?await bcrypt.compare(process.env.EXPECTED_PASSWORD||"",u[0].passwordHash):false,ownerEmailBound:u[0]?.email==="almaystrwbady@gmail.com"}));
        } finally {await pool.end();}
      })().catch(()=>{console.error("Store assertions failed.");process.exitCode=1;});
    `], { ...env, EXPECTED_PASSWORD: password });
    return JSON.parse(output.trim().split("\n").at(-1)!);
  };
  try {
    for (const name of names) {
      await db.execute(sql`create database ${sql.identifier(name)}`);
      created.push(name);
    }
    const env = envFor(names[0]);
    migrate(env);
    migrate(env);
    console.log("PASS initial migration and repeat migration are safe on an isolated database.");
    run("Restore-mode initialization", "npx", ["--no-install", "tsx", "scripts/initialize-store.ts"], { ...env, STORE_INITIALIZATION: "restore" });
    assert.equal(inspect(env).users, 0);
    console.log("PASS restore mode adds no default users before a store import.");
    run("First store initialization", "npx", ["--no-install", "tsx", "scripts/initialize-store.ts"], env);
    run("Repeated store initialization", "npx", ["--no-install", "tsx", "scripts/initialize-store.ts"], { ...env, ADMIN_INITIAL_PASSWORD: randomBytes(24).toString("base64url") });
    const expected = { users: 1, platforms: 6, banks: 4, accounts: 0, customers: 0, rentals: 0, payments: 0, validOriginalPassword: true, ownerEmailBound: true };
    assert.deepEqual(inspect(env), expected);
    console.log("PASS repeat deployment preserves the admin password and adds no demo employees, accounts or sales.");
    const output = run("Private data export", "node", ["scripts/export-store-data.mjs"], env);
    backup = output.match(/Private store-data backup created: ([^\r\n]+)/)?.[1];
    assert.ok(backup);
    assert.equal((await fs.stat(backup!)).mode & 0o777, 0o600);
    const restoreEnv = envFor(names[1]);
    migrate(restoreEnv);
    run("Private data restore", "pg_restore", ["--exit-on-error", "--single-transaction", "--data-only", "--no-owner", "--no-privileges", `--dbname=${restoreEnv.DATABASE_URL}`, backup!], restoreEnv);
    assert.deepEqual(inspect(restoreEnv), expected);
    console.log("PASS private data backup and restore into a fresh migrated database.");
    assert.deepEqual(await baseline(), before);
    console.log("PASS real store row counts are unchanged.");
  } finally {
    if (backup) await fs.unlink(backup).catch(() => {});
    for (const name of created.reverse()) await db.execute(sql`drop database ${sql.identifier(name)} with (force)`);
    await pool.end();
  }
  console.log("Temporary test databases and backup removed.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
