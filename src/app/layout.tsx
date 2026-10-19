import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Cairo } from "next/font/google";
import PwaInstall from "@/components/PwaInstall";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700", "800", "900"] });

export const metadata: Metadata = {
  title: "Maestro Key — مايسترو كي | إدارة اشتراكات المنصات الرقمية",
  description: "نظام إدارة متجر مايسترو كي: مخزون حسابات، بيع وتجديد اشتراكات، سندات دفع، وتنبيهات واتساب.",
  applicationName: "Maestro Key",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icons/favicon-white-v3-64.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-white-v3-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Maestro Key", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050914",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.className} bg-[#070b14] text-slate-100 antialiased`}>
        {children}
        <PwaInstall />
      </body>
    </html>
  );
}
