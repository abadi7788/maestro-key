/**
 * محرك صوت الإشعارات لمتجر مايسترو كي:
 *  - نغمة ثنائية نظيفة مولّدة محلياً بصيغة PCM WAV (data URI) + احتياط Web Audio API
 *  - لا يعتمد على أي ملفات صوتية خارجية أو مسارات شبكة قد تفشل
 *  - يفتح قفل الصوت (HTMLAudioElement + AudioContext) عند أول لمسة أو نقرة أو ضغطة مفتاح
 *  - مفعّل افتراضياً (mk_sound_on !== "0")
 */

const SOUND_PREF_KEY = "mk_sound_on";

let ctx: AudioContext | null = null;
let audioEl: HTMLAudioElement | null = null;
let cachedWavUrl: string | null = null;
let audioUnlocked = false;
let unlockHandlersInstalled = false;
let lastPlayedAt = 0;

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

/**
 * توليد ملف WAV نظيف في الذاكرة (نغمتين E6 ثم B5 بأسلوب إشعار واتساب)
 * ليعمل على هواتف أندرويد و iOS Safari عبر <audio> حتى عندما يتقيد AudioContext.
 */
function buildChimeWavDataUrl(): string {
  if (cachedWavUrl) return cachedWavUrl;
  const sampleRate = 22050;
  const durationSec = 0.44;
  const numSamples = Math.floor(sampleRate * durationSec);
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true); // 16-bit
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    // النغمة الأولى (0.00s - 0.14s): E6 (1318.5 Hz)
    if (t < 0.14) {
      const env = Math.min(1, t / 0.012) * Math.exp(-t * 20);
      sample += Math.sin(2 * Math.PI * 1318.5 * t) * env * 0.45;
      sample += Math.sin(2 * Math.PI * 2637.0 * t) * env * 0.12;
    }

    // النغمة الثانية (0.12s - 0.44s): B5 (987.77 Hz)
    if (t >= 0.12) {
      const dt = t - 0.12;
      const env = Math.min(1, dt / 0.012) * Math.exp(-dt * 11);
      sample += Math.sin(2 * Math.PI * 987.77 * dt) * env * 0.5;
      sample += Math.sin(2 * Math.PI * 1975.54 * dt) * env * 0.12;
    }

    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  cachedWavUrl = `data:audio/wav;base64,${btoa(binary)}`;
  return cachedWavUrl;
}

function getAudioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  try {
    if (!audioEl) {
      audioEl = new Audio(buildChimeWavDataUrl());
      audioEl.preload = "auto";
      audioEl.volume = 0.95;
    }
    return audioEl;
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

/** فتح سياق الصوت + عنصر الصوت على الهاتف عند أول تفاعل للمستخدم */
export async function unlockNotifySound(): Promise<boolean> {
  let ok = false;

  const ac = getCtx();
  if (ac) {
    try {
      if (ac.state === "suspended") {
        await ac.resume();
      }
      if (ac.state === "running") ok = true;
    } catch {}
  }

  const el = getAudioElement();
  if (el && !audioUnlocked) {
    try {
      const prevVol = el.volume;
      el.volume = 0;
      el.currentTime = 0;
      const p = el.play();
      if (p) await p;
      el.pause();
      el.currentTime = 0;
      el.volume = prevVol;
      audioUnlocked = true;
      ok = true;
    } catch {
      try {
        el.volume = 0.95;
      } catch {}
    }
  } else if (audioUnlocked) {
    ok = true;
  }

  return ok;
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
      if (running && audioUnlocked) cleanup();
    });
  };

  for (const ev of events) {
    window.addEventListener(ev, onFirstGesture, { passive: true, capture: true });
  }

  return cleanup;
}

/** تشغيل نغمة الإشعار (HTMLAudioElement + احتياط Web Audio API) مع منع التكرار المزدوج */
export async function playNotifySound(opts?: { force?: boolean }): Promise<boolean> {
  if (!opts?.force && !isNotifySoundEnabled()) return false;

  const now = Date.now();
  if (!opts?.force && now - lastPlayedAt < 1200) {
    return true;
  }
  lastPlayedAt = now;

  // 1. محاولة التشغيل عبر عنصر Audio الحقيقي (الأكثر موثوقية على هواتف أندرويد و iOS)
  const el = getAudioElement();
  if (el) {
    try {
      el.volume = 0.95;
      el.currentTime = 0;
      const p = el.play();
      if (p) await p;
      audioUnlocked = true;
      return true;
    } catch {
      // المتابعة للاحتياط عبر Web Audio API
    }
  }

  // 2. الاحتياط عبر Web Audio API
  const ac = getCtx();
  if (!ac) return false;
  try {
    if (ac.state === "suspended") {
      await ac.resume().catch(() => {});
    }
    if (ac.state !== "running") return false;

    const t = ac.currentTime + 0.02;
    blip(ac, 1318.5, t, 0.11, 0.28);
    blip(ac, 1318.5, t, 0.11, 0.1, "sine");
    blip(ac, 987.77, t + 0.13, 0.25, 0.3);
    blip(ac, 987.77, t + 0.13, 0.25, 0.1, "sine");
    return true;
  } catch {
    return false;
  }
}
