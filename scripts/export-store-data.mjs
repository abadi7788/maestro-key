import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const directory = path.resolve("backups");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `store-data-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  // Create private permissions BEFORE pg_dump starts writing sensitive store data.
  const handle = await fs.open(filename, "wx", 0o600);
  await handle.close();
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("pg_dump", [
        `--dbname=${process.env.DATABASE_URL}`,
        "--format=custom", "--data-only", "--schema=public", "--no-owner", "--no-privileges",
        "--exclude-table-data=public.email_codes", "--exclude-table-data=public.push_subscriptions",
        `--file=${filename}`,
      ], {
        env: { ...process.env },
        stdio: ["ignore", "ignore", "pipe"],
      });
      // Never echo raw connection strings or database credentials on failure.
      child.stderr.resume();
      child.on("error", () => reject(new Error("pg_dump is unavailable. Install PostgreSQL client tools.")));
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Database export failed. Check connection and pg_dump compatibility.")));
    });
    console.log(`Private store-data backup created: ${path.relative(process.cwd(), filename)}`);
    console.log("Contains sensitive data. Keep outside Git/public storage; preserve existing encryption keys separately.");
    console.log("One-time email codes and origin-bound Push subscriptions are intentionally not exported.");
  } catch (error) {
    await fs.unlink(filename).catch(() => {});
    throw error;
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
