import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";

// First production builds run before database migrations; never prerender store data.
export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSeeded();
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
