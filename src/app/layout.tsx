Import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700", "800", "900"] });

export const metadata: Metadata = {
  title: "Maestro Key — مايسترو كي | إدارة اشتراكات المنصات الرقمية",
  description: "نظام إدارة متجر مايسترو كي: مخزون حسابات، بيع وتجديد اشتراكات، سندات دفع، وتنبيهات واتساب.",
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-512x512.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.className} bg-[#070b14] text-slate-100 antialiased`}>
        {children}

        <Script
          src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
          strategy="afterInteractive"
        />
        <Script id="onesignal-init" strategy="afterInteractive">
          {`
            window.OneSignalDeferred = window.OneSignalDeferred || [];
            OneSignalDeferred.push(async function(OneSignal) {
              await OneSignal.init({
                appId: "ac6dd3a1-1dcc-4580-8207-97aa0170ef09",
                serviceWorkerParam: { scope: "/" },
                serviceWorkerPath: "OneSignalSDKWorker.js",
                allowLocalhostAsSecureOrigin: true,
                notifyButton: {
                  enable: true,
                },
              });
            });
          `}
        </Script>
      </body>
    </html>
  );
}
