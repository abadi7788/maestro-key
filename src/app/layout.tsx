import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700", "800", "900"] });

export const metadata: Metadata = {
  title: "Maestro Key — مايسترو كي | إدارة اشتراكات المنصات الرقمية",
  description: "نظام إدارة متجر مايسترو كي: مخزون حسابات، بيع وتجديد اشتراكات، سندات دفع، وتنبيهات واتساب.",
  icons: {
    icon: "/app-icon-192.png",
    apple: "/app-icon-512.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.className} bg-[#070b14] text-slate-100 antialiased`}>{children}</body>
    </html>
  );
}
