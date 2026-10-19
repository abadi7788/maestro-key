"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { registerPwaWorker } from "@/lib/pwa-client";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/** Show a real install action only after the browser grants installation eligibility. */
export default function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void registerPwaWorker();
    const installed = () => window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const onPrompt = (event: Event) => {
      if (installed()) return;
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setPrompt(null); setBusy(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // An expired/blocked browser prompt must not interrupt login or application use.
    } finally {
      // Chromium permits each deferred prompt to be used only once.
      setPrompt(null);
      setBusy(false);
    }
  }

  if (!prompt) return null;
  return (
    <aside className="fixed bottom-24 left-4 z-40 flex items-center gap-2 rounded-2xl border border-white/15 bg-[#0c1426]/95 p-2 text-white shadow-2xl backdrop-blur-xl lg:bottom-5" aria-label="تثبيت التطبيق">
      <button type="button" onClick={install} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[#2563eb] px-4 py-3 text-sm font-bold disabled:opacity-60">
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
        {busy ? "جارٍ فتح التثبيت…" : "تثبيت التطبيق"}
      </button>
      <button type="button" onClick={() => setPrompt(null)} className="rounded-xl p-2 text-slate-400 hover:text-white" aria-label="إخفاء خيار التثبيت"><X size={17} /></button>
    </aside>
  );
}
