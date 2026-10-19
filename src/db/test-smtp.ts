import "dotenv/config";
import { db, pool } from "./index";
import { settings } from "./schema";
import { decryptText } from "../lib/crypto";

async function main() {
  const rows = await db.select().from(settings);
  const map: Record<string, string> = {};
  rows.forEach((r) => { map[r.key] = r.value; });
  const pass = decryptText(map.smtp_pass || "");
  console.log("host", map.smtp_host);
  console.log("user", map.smtp_user);
  console.log("passLen", pass.length);
  if (pass.length < 8) {
    console.log("DECRYPT_FAIL");
    await pool.end();
    return;
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: map.smtp_host,
    port: Number(map.smtp_port || 587),
    secure: false,
    auth: { user: map.smtp_user, pass },
  });
  const info = await transporter.sendMail({
    from: map.smtp_from || map.smtp_user,
    to: map.smtp_user,
    subject: "كود تجربة مايسترو كي",
    text: "إذا وصلتك هذه الرسالة فإعداد البريد يعمل.",
  });
  console.log("SENT", info.messageId);
  await pool.end();
}

main().catch(async (e) => { console.error("ERR", e.message); await pool.end(); process.exit(1); });
