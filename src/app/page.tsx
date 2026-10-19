import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";

export default async function Home() {
  await ensureSeeded();
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
