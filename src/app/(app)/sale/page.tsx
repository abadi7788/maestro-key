import SaleForm from "@/components/SaleForm";
import { ShoppingCart, ScanLine, ShieldCheck } from "lucide-react";

export default function SalePage() {
  return (
    <div className="space-y-5">
      {/* Hero header */}
      <div className="card-deep hero-lock relative overflow-hidden px-6 py-7">
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                  <ShoppingCart size={20} className="text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-black tracking-tight text-white">نقطة البيع</h1>
                    <span className="pill bg-white/10 text-white/80">بيع جديد / تجديد</span>
                  </div>
                  <p className="mt-1 text-[13px] font-semibold text-slate-300">
                    نفس النموذج يخدم الحالتين: اكتب رقم العميل أولاً، وسيقترح النظام التجديد إن كان عميلاً معروفاً.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2">
                <ShieldCheck size={14} className="text-amber-300" />
                <span className="text-[11px] font-bold text-amber-200">محفظة فورية أو سند بنكي</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.06] px-3 py-2">
                <ScanLine size={14} className="text-[#5ba2ff]" />
                <span className="text-[11px] font-bold text-slate-200">قراءة ذكية للسند</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SaleForm />
    </div>
  );
}
