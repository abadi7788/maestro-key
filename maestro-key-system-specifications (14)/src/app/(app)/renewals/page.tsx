"use client";
import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { api } from "@/lib/client";
import { Empty, Spinner } from "@/components/ui";
import { DueCard } from "../dashboard/page";

export default function RenewalsPage() {
  const [due, setDue] = useState<any[] | null>(null);
  useEffect(() => { api("/api/rentals?view=due").then((d) => setDue(d.rentals)).catch(() => setDue([])); }, []);
  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black"><RefreshCcw className="text-[#2563eb]" /> تجديدات مستحقة</h1>
      <p className="mb-5 text-sm font-semibold text-slate-500">اشتراكات تنتهي خلال 3 أيام أو انتهت ولم تُغلق بعد. عندما يحوّل العميل المبلغ: افتح ملفه، اربط سند الإيداع والمدة، وسيُمدَّد اشتراكه على نفس الحساب تلقائياً.</p>
      {!due ? <Spinner /> : due.length === 0 ? <Empty icon={<RefreshCcw size={44} />} title="لا توجد تجديدات مستحقة 🎉" hint="كل الاشتراكات النشطة بعيدة عن الانتهاء." /> : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">{due.map((r) => <DueCard key={r.id} r={r} />)}</div>
      )}
    </div>
  );
}
