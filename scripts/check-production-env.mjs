import { createECDH } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

/** Returns configuration problems without printing values or contacting providers. */
export function productionProblems(env) {
  const problems = [];
  const required = [
    "DATABASE_URL", "SESSION_SECRET", "ACCOUNT_ENCRYPTION_KEY", "ADMIN_INITIAL_PASSWORD",
    "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
    "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "CRON_SECRET",
  ];
  for (const key of required) if (!env[key]?.trim()) problems.push(`${key} is missing.`);
  for (const key of ["SESSION_SECRET", "ACCOUNT_ENCRYPTION_KEY", "CRON_SECRET"]) {
    if (env[key] && env[key].length < 32) problems.push(`${key} needs at least 32 characters.`);
  }
  if (env.ADMIN_INITIAL_PASSWORD && env.ADMIN_INITIAL_PASSWORD.length < 12) {
    problems.push("ADMIN_INITIAL_PASSWORD needs at least 12 characters.");
  }
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) problems.push("DATABASE_URL must be a PostgreSQL connection string.");
      if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) problems.push("Production needs a persistent remote PostgreSQL database, not the preview database.");
    } catch { problems.push("DATABASE_URL is not a valid connection string."); }
  }
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT is invalid.");
  if (port === 587 && env.SMTP_SECURE === "true") problems.push("Use SMTP_SECURE=false for STARTTLS on port 587.");
  for (const key of ["SMTP_USER", "SMTP_FROM"]) {
    if (env[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env[key])) problems.push(`${key} must be a valid email address.`);
  }
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    try {
      const privateKey = Buffer.from(env.VAPID_PRIVATE_KEY, "base64url");
      const publicKey = Buffer.from(env.VAPID_PUBLIC_KEY, "base64url");
      if (privateKey.length !== 32 || publicKey.length !== 65) throw new Error();
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(privateKey);
      if (!ecdh.getPublicKey().equals(publicKey)) throw new Error();
    } catch { problems.push("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be a matching Web Push key pair."); }
  }
  if (env.VAPID_SUBJECT && !/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT)) problems.push("VAPID_SUBJECT must be a mailto or HTTPS URI.");
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  nextEnv.loadEnvConfig(process.cwd());
  const problems = productionProblems(process.env);
  if (problems.length) {
    console.error("Production configuration is not ready:\n" + problems.map((p) => `- ${p}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Production configuration checks passed. No credentials printed.");
  }
}
