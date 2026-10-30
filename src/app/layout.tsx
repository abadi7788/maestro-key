import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";


export const metadata: Metadata = {
  title: "Maestro Key — مايسترو كي",
  description: "نظام إدارة متجر مايسترو كي",
};


export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-[#070b14] text-slate-100 antialiased">{children}</body>
    </html>
  );
}

