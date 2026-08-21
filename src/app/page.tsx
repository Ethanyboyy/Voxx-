import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { hasAnyUser } from "@/lib/auth/service";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (user) redirect("/brain");
  if (await hasAnyUser()) redirect("/login");
  redirect("/setup");
}
