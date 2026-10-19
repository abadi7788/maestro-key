import { NextRequest, NextResponse } from "next/server";

/** حماية كل صفحات النظام على مستوى الخادم — بدون تسجيل دخول لا تُعرض أي صفحة ولا أي بيانات. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("maestro_session")?.value;

  // صفحة الدخول: إذا كان مسجلاً بالفعل، وجّهه لنقطة البيع
  if (pathname === "/login") {
    if (token) return NextResponse.redirect(new URL("/dashboard", req.url));
    return NextResponse.next();
  }

  // أي صفحة أخرى: لازم جلسة صالحة
  if (!token) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // استثناءات: ملفات next الثابتة والـ API (الـ API يحمي نفسه بنفسه) والصفحة الرئيسية (توجهها الصفحة نفسها)
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|logo.png|icon.png|.*\\..*).*)"],
};
