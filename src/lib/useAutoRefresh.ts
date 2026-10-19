"use client";
import { useEffect, useRef } from "react";

/**
 * مزامنة تلقائية: يعيد تنفيذ دالة التحميل كل `ms` mili ثانية (افتراضياً 8 ثوانٍ).
 * يتوقف تلقائياً عندما يكون التبويب مخفياً (لتوفير بيانات الجوال والبطارية)،
 * ويعيد المزامنة فوراً عند العودة للتبويب.
 */
export function useAutoRefresh(cb: () => void | Promise<void>, ms = 8000) {
  const ref = useRef(cb);
  ref.current = cb;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          void ref.current();
          try {
            // إشعار كل المكوّنات المكرسة (مثل نموذج البيع) بأن المخزون قد تغيّر
            window.dispatchEvent(new Event("maestro-sync"));
          } catch {}
        }
      }, ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
        void ref.current(); // مزامنة فورية عند العودة للتبويب
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
}
