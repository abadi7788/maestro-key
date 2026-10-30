import RentalsList from "@/components/RentalsList";

export default function MySalesPage() {
  return (
    <RentalsList
      view="mine"
      title="🗂️ مبيعاتي"
      subtitle="عملياتك التي سجلتها عبر المحفظة أو السندات البنكية — اضغط «عرض بيانات الحساب» لإرسالها للعميل عبر واتساب."
    />
  );
}
