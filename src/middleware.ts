import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret } from "@/lib/session-shared";
import { isAdminRole, isAdminOnlyPath, homeForRole } from "@/lib/roles";

type Session = { userId: number; role: string; username: string } | null;

function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * تحقق حقيقي من توقيع الجلسة داخل الـMiddleware (Web Crypto — متوافق مع Edge).
 * نفس الخوارزمية المستخدمة في crypto.ts: key = SHA256(secret)، ثم HMAC-SHA256.
 */
async function verifySessionEdge(token: string | undefined): Promise<Session> {
  try {
    if (!token) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    if (!body || !sigB64) return null;

    const enc = new TextEncoder();
    const keyBytes = await crypto.subtle.digest("SHA-256", enc.encode(getSessionSecret()));
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      b64urlToBytes(sigB64) as unknown as BufferSource,
      enc.encode(body),
    );
    if (!ok) return null;

    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (!data?.exp || Number(data.exp) < Date.now()) return null;
    if (!data.userId) return null;
    return { userId: Number(data.userId), role: String(data.role ?? ""), username: String(data.username ?? "") };
  } catch {
    return null;
  }
}

/**
 * حماية الصفحات على مستوى الخادم:
 * 1) بدون جلسة صالحة → /login (مع حفظ الوجهة ?next=)
 * 2) صفحة الدخول مع جلسة صالحة → الصفحة الرئيسية حسب الدور
 * 3) الموظف ممنوع من صفحات المدير → يُحوَّل لنقطة البيع /sale
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("maestro_session")?.value;
  const session = await verifySessionEdge(token);

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL(homeForRole(session.role), req.url));
    return NextResponse.next();
  }

  if (!session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAdminOnlyPath(pathname) && !isAdminRole(session.role)) {
    return NextResponse.redirect(new URL("/sale", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // استثناءات: الـ API والتحميل وملفات next الثابتة وأي ملف بامتداد
  matcher: ["/((?!api|download|downloads|_next/static|_next/image|favicon.ico|logo.png|icon.png|.*\\..*).*)"],
};

