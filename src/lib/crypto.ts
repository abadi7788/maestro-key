import crypto from "crypto";
import { getSessionSecret } from "./session-shared";

const secret = getSessionSecret();
const key = crypto.createHash("sha256").update(secret).digest();

export function encryptText(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptText(payload: string | null | undefined): string {
  if (!payload) return "";
  if (!payload.startsWith("v1:")) return payload; // legacy plain fallback
  try {
    const [, ivB, tagB, dataB] = payload.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(input: string) {
  const pad = input.length % 4 ? "=".repeat(4 - (input.length % 4)) : "";
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

export function signSession(payload: Record<string, unknown>): string {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 }));
  const sig = crypto.createHmac("sha256", key).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifySession(token: string | undefined | null): { userId: number; role: string; username: string } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", key).update(body).digest());
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(fromB64url(body));
    if (!data.exp || data.exp < Date.now()) return null;
    return { userId: Number(data.userId), role: String(data.role), username: String(data.username) };
  } catch { return null; }
}
