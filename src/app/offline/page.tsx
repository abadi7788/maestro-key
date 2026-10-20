"use client";
import { useEffect, useState } from "react";

/**
 * صفحة عدم الاتصال (PWA Offline Page) — بهوية متجر Maestro Key.
 * تنسيقها مضمّن (Inline CSS) عمداً حتى تظهر بكامل جمالها
 * حتى لو لم تُحمّل ملفات التنسيق بسبب انقطاع الإنترنت.
 */
export default function OfflinePage() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // إعادة التحميل تلقائياً فور عودة الاتصال
    const onOnline = () => {
      setOnline(true);
      window.location.reload();
    };
    const onOffline = () => setOnline(false);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return (
    <main dir="rtl" lang="ar" className="mk-off-root">
      <style>{`
        .mk-off-root {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          font-family: "Segoe UI", Tahoma, Arial, sans-serif;
          color: #fff;
          background:
            radial-gradient(ellipse 600px 340px at 50% -60px, rgba(20,99,255,.22), transparent 60%),
            radial-gradient(ellipse 500px 320px at 85% 110%, rgba(255,36,56,.14), transparent 60%),
            linear-gradient(180deg, #03040a 0%, #071224 55%, #14060d 100%);
        }
        .mk-off-card {
          width: 100%;
          max-width: 420px;
          text-align: center;
          background: rgba(5,9,20,.82);
          border: 1px solid rgba(255,255,255,.10);
          border-radius: 26px;
          padding: 36px 28px 30px;
          box-shadow: 0 35px 90px rgba(0,0,0,.6);
        }
        .mk-off-logo {
          width: 138px;
          height: 138px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid rgba(255,255,255,.20);
          box-shadow: 0 0 44px rgba(20,99,255,.45), 0 0 78px rgba(255,36,56,.20);
        }
        .mk-off-brand { margin-top: 14px; font-size: 11px; font-weight: 900; letter-spacing: .42em; color: #57c8ff; }
        .mk-off-brand span { color: #ff4055; }
        .mk-off-title { margin: 6px 0 0; font-size: 28px; font-weight: 900; }
        .mk-off-status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 14px;
          padding: 7px 16px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 800;
          background: rgba(255,60,80,.12);
          border: 1px solid rgba(255,60,80,.35);
          color: #ff9aa5;
        }
        .mk-off-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff4055; box-shadow: 0 0 10px #ff4055; animation: mk-off-blink 1.4s ease-in-out infinite; }
        .mk-off-dot.on { background: #34d399; box-shadow: 0 0 10px #34d399; animation: none; }
        @keyframes mk-off-blink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        .mk-off-text { margin: 16px 0 0; font-size: 14.5px; line-height: 2; color: #c4cee0; font-weight: 600; }
        .mk-off-btn {
          width: 100%;
          margin-top: 24px;
          padding: 15px 16px;
          border: none;
          border-radius: 16px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 900;
          color: #fff;
          background: linear-gradient(to left, #1463ff, #7b61ff, #ff2438);
          box-shadow: 0 14px 35px rgba(20,99,255,.35);
          transition: transform .12s ease, filter .12s ease;
        }
        .mk-off-btn:hover { filter: brightness(1.12); }
        .mk-off-btn:active { transform: scale(.98); }
        .mk-off-tip { margin-top: 14px; font-size: 12px; color: rgba(255,255,255,.38); font-weight: 600; }
        .mk-off-foot { margin-top: 18px; font-size: 11px; color: rgba(255,255,255,.28); font-weight: 600; }
      `}</style>

      <div className="mk-off-card">
        <img src="/logo.png" alt="Maestro Key" className="mk-off-logo" />
        <p className="mk-off-brand">MAESTRO <span>KEY</span></p>
        <h1 className="mk-off-title">غير متصل بالإنترنت</h1>

        <div className="mk-off-status">
          <span className={online ? "mk-off-dot on" : "mk-off-dot"} />
          {online ? "تم استعادة الاتصال…" : "لا يوجد اتصال"}
        </div>

        <p className="mk-off-text">
          يبدو أنك غير متصل بالإنترنت،
          <br />
          يرجى التحقق من الشبكة وإعادة المحاولة
        </p>

        <button
          type="button"
          className="mk-off-btn"
          onClick={() => window.location.reload()}
        >
          🔄 إعادة المحاولة
        </button>

        <p className="mk-off-tip">سيتم تحديث الصفحة تلقائياً فور عودة الاتصال</p>
        <p className="mk-off-foot">Maestro Key — متجر مايسترو كي</p>
      </div>
    </main>
  );
}
