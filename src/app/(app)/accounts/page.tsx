import AccountsManager from "@/components/AccountsManager";

export default function AccountsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-black text-white">📦 مخزون الحسابات</h1>
      <p className="mb-5 text-sm font-semibold text-slate-400">إدارة حسابات المنصات والبروفايلات وأسعار البيع — كلمات المرور والأكواد مشفرة، وكل عرض لها يُسجَّل في سجل التدقيق.</p>
      <AccountsManager />
    </div>
  );
}
