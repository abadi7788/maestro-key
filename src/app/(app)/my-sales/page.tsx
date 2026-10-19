import RentalsList from "@/components/RentalsList";

export default function MySalesPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-black">🗂️ مبيعاتي</h1>
      <p className="mb-5 text-sm font-semibold text-slate-500">عملياتك التي سجلتها أنت فقط، وحالة مراجعة المدير لسنداتها. بيانات الحسابات لا تعود للظهور هنا حفاظاً على الأمان.</p>
      <RentalsList mode="mine" />
    </div>
  );
}
