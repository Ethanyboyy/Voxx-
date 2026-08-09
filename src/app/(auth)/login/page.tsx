import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth/service";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  if (!(await hasAnyUser())) redirect("/setup");
  return <LoginForm />;
}
