/**
 * نغمة تنبيه نظيفة بأسلوب واتساب — مولّدة برمجياً عبر Web Audio API.
 * لا تحتاج أي ملفات صوتية خارجية ولا تفشل بسبب المسارات.
 *
 * المزايا:
 *  - مفعّلة افتراضياً (mk_sound_on !== "0")
 *  - تفتح قفل المتصفح تلقائياً عند أول نقرة أو لمسة أو ضغطة مفتاح للمستخدم
 *  - تستأنف AudioContext قبل العزف إذا كان suspended لضمان عدم ضياع أي نغمة
 */

const SOUND_PREF_KEY = "mk_sound_on";

let ctx: AudioContext | null = null;
let unlockHandlersInstalled = false;

function getAudioConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

function getCtx(): AudioContext | null {
  try {
    const AC = getAudioConstructor();
    if (!AC) return null;
    if (!ctx || ctx.state === "closed") ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

export function isNotifySoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setNotifySoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? "1" : "0");
  } catch {}
}

function blip(
  ac: AudioContext,
  freq: number,
  start: number,
  dur: number,
  vol: number,
  type: OscillatorType = "triangle",
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** فتح سياق الصوت واستئنافه عند تفاعل المستخدم */
export async function unlockNotifySound(): Promise<boolean> {
  const ac = getCtx();
  if (!ac) return false;
  try {
    if (ac.state === "suspended") {
      await ac.resume();
    }
    return ac.state === "running";
  } catch {
    return false;
  }
}

/**
 * تثبيت مستمعات أول تفاعل للمستخدم على مستوى الصفحة
 * لفتح قفل الصوت تلقائياً بمجرد أول نقرة أو لمسة أو ضغطة زر.
 */
export function installSoundUnlockHandlers(): () => void {
  if (typeof window === "undefined" || unlockHandlersInstalled) {
    return () => {};
  }
  unlockHandlersInstalled = true;

  const events: Array<keyof WindowEventMap> = ["pointerdown", "touchstart", "keydown", "click"];

  const cleanup = () => {
    for (const ev of events) {
      window.removeEventListener(ev, onFirstGesture, true);
    }
    unlockHandlersInstalled = false;
  };

  const onFirstGesture = () => {
    void unlockNotifySound().then((running) => {
      if (running) cleanup();
    });
  };

  for (const ev of events) {
    window.addEventListener(ev, onFirstGesture, { passive: true, capture: true });
  }

  return cleanup;
}

/** تشغيل نغمة الإشعار بأمان مع استئناف السياق تلقائياً قبل التشغيل */
export async function playNotifySound(opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force && !isNotifySoundEnabled()) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    if (ac.state === "suspended") {
      await ac.resume().catch(() => {});
    }
    if (ac.state !== "running") return;

    const t = ac.currentTime + 0.02;
    // النغمة الأولى: مرتفعة وقصيرة (E6)
    blip(ac, 1318.5, t, 0.11, 0.24);
    blip(ac, 1318.5, t, 0.11, 0.08, "sine");
    // النغمة الثانية: منخفضة وأطول قليلاً (B5)
    blip(ac, 987.77, t + 0.13, 0.25, 0.26);
    blip(ac, 987.77, t + 0.13, 0.25, 0.09, "sine");
  } catch {
    /* الصوت تحسين فقط — لا يكسر شيئاً */
  }
}
