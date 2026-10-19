import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const [{ ensureSeeded }, { pool }] = await Promise.all([
    import("../src/lib/seed"),
    import("../src/db/index"),
  ]);
  try {
    if (process.env.STORE_INITIALIZATION === "restore") {
      console.log("Restore mode: schema migrated; automatic store creation is disabled until existing data is imported.");
      return;
    }
    await ensureSeeded();
    console.log("Store initialization complete. Existing store data was preserved.");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("Store initialization failed. Check database migrations and ADMIN_INITIAL_PASSWORD; no store credentials were printed.");
  process.exitCode = 1;
});
