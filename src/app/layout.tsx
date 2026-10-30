import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/500.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/900.css";
import "@fontsource/cairo/700.css";
import "@fontsource/cairo/800.css";
import "./globals.css";
import PwaInstall from "@/components/PwaInstall";

export const metadata: Metadata = {
  title: "Maestro Key — مايسترو كي | إدارة اشتراكات المنصات الرقمية",
  description: "نظام إدارة متجر مايسترو كي: مخزون حسابات، بيع وتجديد اشتراكات، محافظ موظفين، سندات دفع، وتنبيهات واتساب.",
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-512x512.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-[#070b14] text-slate-100 antialiased">
        {children}
        <PwaInstall />
      </body>
    </html>
  );
}
