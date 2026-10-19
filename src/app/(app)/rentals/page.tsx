import RentalsList from "@/components/RentalsList";

export default function RentalsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-black">🧾 المبيعات والإيجارات والسندات</h1>
      <p className="mb-5 text-sm font-semibold text-slate-500">كل عملية مرتبطة بسندها: راجع الصورة، اعتمد السند، أو ارفضه فيُلغى الاشتراك ويعود الحساب للمخزون.</p>
      <RentalsList mode="all" />
    </div>
  );
}
