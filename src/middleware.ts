import { NextRequest, NextResponse } from "next/server";

/**
 * Edge-level route guard:
 * - No session -> redirect to /login.
 * - EMPLOYEE role is blocked from admin-only pages (APIs are also protected by requireAdmin).
 *   We read the role from the session token payload (base64url) for routing only;
 *   real authorization is enforced by getCurrentUser + requireAdmin on every API.
 */
const ADMIN_ONLY = ["/inbox", "/accounts", "/rentals", "/customers", "/trash", "/audit", "/settings"];

function readRole(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const [body] = token.split(".");
    if (!body) return null;
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload?.exp && Date.now() > Number(payload.exp)) return null; // expired
    return payload?.role ?? null;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("maestro_session")?.value;
  const role = readRole(token);

  // Login page: if already authenticated, route by role
  if (pathname === "/login") {
    if (token && role) return NextResponse.redirect(new URL(role === "ADMIN" ? "/dashboard" : "/sale", req.url));
    return NextResponse.next();
  }

  // All other pages require a valid session
  if (!token || !role) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Admin-only pages: employees are redirected to the POS
  if (role !== "ADMIN" && ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.redirect(new URL("/sale", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|logo.png|icon.png|.*\\..*).*)"],
};
