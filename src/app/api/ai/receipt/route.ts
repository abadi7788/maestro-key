import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * قراءة سند التحويل بالذكاء الاصطناعي.
 * يحاول استخراج: اسم البنك / رقم العملية / المبلغ من الصورة المرفوعة.
 * يدعم الصور النصية (SVG) بقراءة المحتوى مباشرة، والصور الحقيقية عبر مزوّد AI إن توفر مفتاح.
 * لا يُعطّل النموذج أبداً — يعيد ما استطاع استخراجه ويترك الحقول اليدوية للمستخدم.
 */
export async function POST(req: Request) {
  try {
    await requireUser();
    const b = await req.json().catch(() => ({}));
    const image: string = String(b.image || "");
    const banks: Array<{ id: number; name: string }> = Array.isArray(b.banks) ? b.banks : [];
    if (!image.startsWith("data:")) {
      return NextResponse.json({ error: "صورة غير صالحة" }, { status: 400 });
    }

    // 1) محاولة استخراج نصي (SVG / صور نصية مضمنة)
    let text = "";
    try {
      if (image.startsWith("data:image/svg")) {
        const comma = image.indexOf(",");
        const payload = image.slice(comma + 1);
        text = image.includes(";base64,") ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
      }
    } catch { /* نتجاهل */ }

    // 2) إذا لم نحصل على نص وكانت الصورة حقيقية، جرّب مزوّد AI إن وُجد المفتاح
    if (!text && process.env.AI_RECEIPT_URL) {
      try {
        const r = await fetch(process.env.AI_RECEIPT_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(process.env.AI_RECEIPT_KEY ? { authorization: `Bearer ${process.env.AI_RECEIPT_KEY}` } : {}),
          },
          body: JSON.stringify({ image }),
          signal: AbortSignal.timeout(12_000),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && (j.transactionRef || j.amount || j.bankName)) {
          const bankId = banks.find((x) => (j.bankName || "").includes(x.name) || x.name.includes(j.bankName || ""))?.id ?? null;
          return NextResponse.json({ ok: true, ...j, bankId });
        }
      } catch { /* نتجاهل ونرجع للطريقة اليدوية */ }
    }

    // 3) استخراج محلي من النص المتاح (SVG مثلًا)
    const flat = text.replace(/<[^>]+>/g, " ");
    const decode = (s: string) => s
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/%23/g, "#")
      .replace(/%20/g, " ").replace(/%3A/g, ":").replace(/%2F/g, "/");
    const readable = decode(flat);

    const amounts = [...readable.matchAll(/(\d{2,})\s*(?:ر\.?ي|ريال|YER|Riyal|رس)/gi)].map((m) => Number(m[1]));
    const refMatch =
      readable.match(/(?:رقم|العملية|الحوالة|Ref|Reference|Transaction|Operation)\s*[:：\-]?\s*([A-Z0-9\-\/]{6,24})/i) ||
      readable.match(/([A-Z]{2,5}-\d{4,12})/) ||
      readable.match(/\b([A-Z]{2,6}\d{6,12})\b/);

    const matchedBank =
      banks.find((x) => readable.includes(x.name)) ??
      banks.find((x) => x.name.includes(readable.match(/(الكريمي|القطيبي|جيب|ون كاش|جوالي|محفظة|الأهلي|الراجحي|Kuraimi|QNB|Jaib|OneCash|Cash)/i)?.[1] || "###")) ??
      null;
    const bankName = matchedBank?.name ?? readable.match(/(الكريمي|القطيبي|جيب|ون كاش|جوالي|محفظة|الأهلي|الراجحي|Kuraimi|QNB|Jaib|OneCash|Cash)/i)?.[1] ?? "";

    return NextResponse.json({
      ok: true,
      bankName: bankName || undefined,
      transactionRef: refMatch?.[1] || undefined,
      amount: amounts.length ? Math.max(...amounts) : undefined,
      bankId: bankName ? banks.find((x) => x.name === bankName)?.id ?? null : null,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "تعذر قراءة السند — أكمل البيانات يدوياً" }, { status: 500 });
  }
}
