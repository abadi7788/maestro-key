/**
 * نغمة تنبيه لطيفة بأسلوب واتساب — مولّدة برمجياً عبر Web Audio API.
 * لا تحتاج أي ملفات صوتية في public.
 *
 * التصميم: نغمتان متتابعتان (مرتفعة قصيرة ثم منخفضة أطول قليلاً)
 * مع غلاف صوتي ناعم (attack/decay) حتى لا تكون حادة.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (!ctx || ctx.state === "closed") ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
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

/** تشغيل نغمة الإشعار (آمنة: أي فشل يُتجاهل بصمت ولا يكسر الواجهة). */
export function playNotifySound(): void {
  const ac = getCtx();
  if (!ac) return;
  try {
    const t = ac.currentTime + 0.02;
    // النغمة الأولى: مرتفعة وقصيرة (E6)
    blip(ac, 1318.5, t, 0.11, 0.22);
    blip(ac, 1318.5, t, 0.11, 0.06, "sine");
    // النغمة الثانية: منخفضة وأطول قليلاً (B5)
    blip(ac, 987.77, t + 0.13, 0.24, 0.24);
    blip(ac, 987.77, t + 0.13, 0.24, 0.07, "sine");
  } catch {
    /* الصوت تحسين فقط — لا يكسر شيئاً */
  }
}

/** فتح سياق الصوت عند تفاعل المستخدم (زر التفعيل) حتى تُسمح الأصوات لاحقاً. */
export function unlockNotifySound(): void {
  getCtx();
}
