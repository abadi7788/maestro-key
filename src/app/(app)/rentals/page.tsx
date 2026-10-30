import RentalsList from "@/components/RentalsList";

export default function RentalsPage() {
  return (
    <RentalsList
      view="all"
      adminControls={true}
      title="🧾 المبيعات والإيجارات والسندات"
      subtitle="كل عمليات المتجر (محفظة وسندات بنكية): اعتمد السندات، اعرض البيانات، أو ألغِ الطلب مع استرداد الرصيد للمحفظة."
    />
  );
}
