import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { hasAnyUser } from "@/lib/auth/service";
import { LandingPage } from "@/components/landing/LandingPage";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (user) redirect("/brain");
  const mode = (await hasAnyUser()) ? "login" : "setup";
  return <LandingPage mode={mode} />;
}
