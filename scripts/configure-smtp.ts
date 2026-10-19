import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const [{ db, pool }, { settings }, { encryptText }, { eq }] = await Promise.all([
    import("../src/db/index"),
    import("../src/db/schema"),
    import("../src/lib/crypto"),
    import("drizzle-orm"),
  ]);
  try {
    const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
    if (required.some((key) => !process.env[key]?.trim())) {
      throw new Error("SMTP environment values are incomplete.");
    }
    const values: Record<string, string> = {
      smtp_host: process.env.SMTP_HOST!.trim(),
      smtp_port: process.env.SMTP_PORT || "587",
      smtp_secure: process.env.SMTP_SECURE || "false",
      smtp_user: process.env.SMTP_USER!.trim(),
      smtp_from: process.env.SMTP_FROM!.trim(),
      smtp_pass: encryptText(process.env.SMTP_PASS!),
    };
    await db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(values)) {
        const [existing] = await tx.select({ id: settings.id }).from(settings).where(eq(settings.key, key)).limit(1);
        if (existing) await tx.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.id, existing.id));
        else await tx.insert(settings).values({ key, value });
      }
    });
    console.log("SMTP settings saved. Password is encrypted; no credentials were printed.");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("Could not save SMTP settings. Verify environment values and database availability.");
  process.exitCode = 1;
});
