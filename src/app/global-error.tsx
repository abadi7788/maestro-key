"use client";

export const dynamic = "force-dynamic";

export default function GlobalError({

  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <h2>حدث خطأ غير متوقع</h2>
        <button type="button" onClick={() => reset()}>
          إعادة المحاولة
        </button>
      </body>
    </html>
  );
}
