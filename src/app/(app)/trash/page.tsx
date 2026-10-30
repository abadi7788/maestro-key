import AccountsManager from "@/components/AccountsManager";

export default function TrashPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-black">🗑️ سلة المحذوفات</h1>
      <p className="mb-5 text-sm font-semibold text-slate-400">الحذف هنا ناعم — لا يختفي شيء من قاعدة البيانات. استرجع أي حساب للمخزون، أو احذفه نهائياً فقط إن لم يكن له سجل إيجارات.</p>
      <AccountsManager trash={true} />
    </div>
  );
}
