import AccountsManager from "@/components/AccountsManager";

export default function AccountsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-black">📦 مخزون الحسابات</h1>
      <p className="mb-5 text-sm font-semibold text-slate-500">للمدير فقط. الحساب صالح لفترة طويلة ويُؤجَّر لفترات قصيرة — كلمات المرور مشفرة، وكل عرض لها يُسجَّل في سجل التدقيق.</p>
      <AccountsManager />
    </div>
  );
}
