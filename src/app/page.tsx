import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { homeForRole } from "@/lib/roles";
import { ensureSeeded } from "@/lib/seed";

export default async function Home() {
  await ensureSeeded();
  const user = await getCurrentUser();
  // التوجيه حسب الدور الفعلي من قاعدة البيانات: مدير → لوحة التحكم، موظف → نقطة البيع
  redirect(user ? homeForRole(user.role) : "/login");
}
