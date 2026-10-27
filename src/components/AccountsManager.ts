"use client";

import { useEffect, useState } from "react";

interface ProfileItem {
  profileName: string;
  pin: string;
}

export default function AccountsManager() {
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [platformsList, setPlatformsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [platformId, setPlatformId] = useState<number>(0);
  const [deliveryKind, setDeliveryKind] = useState("CREDENTIALS");
  const [type, setType] = useState<"FULL" | "PROFILE">("FULL");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [profilesList, setProfilesList] = useState<ProfileItem[]>([
    { profileName: "بروفايل 1", pin: "" },
  ]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [accRes, platRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/admin-data"),
      ]);
      const accData = await accRes.json();
      const platData = await platRes.json();
      if (accData.accounts) setAccountsList(accData.accounts);
      if (platData.platforms) {
        setPlatformsList(platData.platforms);
        if (platData.platforms.length > 0 && !platformId) {
          setPlatformId(platData.platforms[0].id);
        }
      }
    } catch {
      console.error("فشل تحميل البيانات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddProfileField = () => {
    setProfilesList((prev) => [
      ...prev,
      { profileName: `بروفايل ${prev.length + 1}`, pin: "" },
    ]);
  };

  const handleRemoveProfileField = (index: number) => {
    if (profilesList.length > 1) {
      setProfilesList((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleProfileChange = (index: number, field: keyof ProfileItem, val: string) => {
    setProfilesList((prev) => {
      const updated = [...prev];
      updated[index][field] = val;
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId,
          deliveryKind,
          type,
          email: email || null,
          password: password || null,
          inviteLink: inviteLink || null,
          licenseKey: licenseKey || null,
          expiryDate: expiryDate || null,
          notes: notes || null,
          salePrice: salePrice ? Number(salePrice) : null,
          profiles: type === "PROFILE" ? profilesList : [],
        }),
      });

      const resData = await res.json();
      if (res.ok && resData.ok) {
        setIsModalOpen(false);
        setEmail("");
        setPassword("");
        setInviteLink("");
        setLicenseKey("");
        setNotes("");
        setSalePrice("");
        setProfilesList([{ profileName: "بروفايل 1", pin: "" }]);
        await loadData();
      } else {
        alert(resData.error || "تعذر حفظ الحساب");
      }
    } catch {
      alert("خطأ في الاتصال بالخادم");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg transition-all"
        >
          + إضافة حساب جديد للمخزون
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-y-auto overscroll-contain">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <h3 className="text-lg font-bold text-white">إضافة حساب للمخزون</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 py-4 flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">المنصة</label>
                <select
                  value={platformId}
                  onChange={(e) => setPlatformId(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  {platformsList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">صيغة التسليم</label>
                <select
                  value={deliveryKind}
                  onChange={(e) => setDeliveryKind(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  <option value="CREDENTIALS">بيانات حساب (إيميل + باسورد)</option>
                  <option value="INVITE_LINK">رابط دعوة / تفعيل</option>
                  <option value="LICENSE_KEY">كود / مفتاح رقمي</option>
                </select>
              </div>

              {deliveryKind === "CREDENTIALS" && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">نوع الحساب</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setType("FULL")}
                      className={`py-2 rounded-xl text-sm font-medium transition-colors ${
                        type === "FULL" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      حساب كامل (Full Account)
                    </button>
                    <button
                      type="button"
                      onClick={() => setType("PROFILE")}
                      className={`py-2 rounded-xl text-sm font-medium transition-colors ${
                        type === "PROFILE" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      بروفايلات (Profiles)
                    </button>
                  </div>
                </div>
              )}

              {deliveryKind === "CREDENTIALS" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">البريد الإلكتروني</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">كلمة المرور</label>
                    <input
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="كلمة المرور"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    />
                  </div>
                </div>
              )}

              {deliveryKind === "INVITE_LINK" && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">رابط الدعوة</label>
                  <input
                    type="url"
                    required
                    value={inviteLink}
                    onChange={(e) => setInviteLink(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              )}

              {deliveryKind === "LICENSE_KEY" && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">كود الترخيص / المفتاح</label>
                  <input
                    type="text"
                    required
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              )}

              {deliveryKind === "CREDENTIALS" && type === "PROFILE" && (
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-400">قائمة البروفايلات ورموز PIN</span>
                    <button
                      type="button"
                      onClick={handleAddProfileField}
                      className="text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white px-2.5 py-1 rounded-lg border border-blue-500/30 transition-all"
                    >
                      + إضافة بروفايل
                    </button>
                  </div>

                  <div className="space-y-2">
                    {profilesList.map((prof, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          required
                          placeholder="اسم البروفايل"
                          value={prof.profileName}
                          onChange={(e) => handleProfileChange(idx, "profileName", e.target.value)}
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                        <input
                          type="text"
                          placeholder="رمز PIN"
                          value={prof.pin}
                          onChange={(e) => handleProfileChange(idx, "pin", e.target.value)}
                          className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                        {profilesList.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveProfileField(idx)}
                            className="text-red-400 hover:text-red-300 p-1 text-sm"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">تاريخ الانتهاء</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">سعر البيع (اختياري)</label>
                  <input
                    type="number"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">ملاحظات</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3 sticky bottom-0 bg-slate-900 z-10">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {submitting ? "جاري الحفظ..." : "حفظ الحساب"}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">جاري تحميل المخزون...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm text-slate-300">
              <thead className="bg-slate-800 text-slate-400 font-medium">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">المنصة</th>
                  <th className="p-3">النوع</th>
                  <th className="p-3">بيانات التسليم</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">البروفايلات المتاحة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {accountsList.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-800/40">
                    <td className="p-3">{acc.id}</td>
                    <td className="p-3 font-semibold text-white">{acc.platformName}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${acc.type === "FULL" ? "bg-amber-500/20 text-amber-300" : "bg-purple-500/20 text-purple-300"}`}>
                        {acc.type === "FULL" ? "حساب كامل" : "بروفايلات"}
                      </span>
                    </td>
                    <td className="p-3 text-xs font-mono">{acc.email || acc.inviteLink || "كود ترخيص"}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">
                        {acc.status}
                      </span>
                    </td>
                    <td className="p-3">
                      {acc.type === "PROFILE" ? (
                        <div className="flex flex-wrap gap-1">
                          {acc.profiles?.map((p: any) => (
                            <span key={p.id} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[11px]">
                              {p.profileName} {p.pin ? `(PIN: ${p.pin})` : ""}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}