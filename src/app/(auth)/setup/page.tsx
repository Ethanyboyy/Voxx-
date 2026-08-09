import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth/service";
import { getCurrentUser } from "@/lib/auth/session";
import { SetupForm } from "@/components/auth/SetupForm";

export default async function SetupPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  if (await hasAnyUser()) redirect("/login");
  return <SetupForm />;
}
