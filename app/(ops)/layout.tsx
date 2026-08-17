import { redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator";
import { EscapeToBack } from "@/components/escape-to-back";
import { AppSidebar } from "@/components/app-sidebar";

// Structurally separate from the sales-side (app) layout in the sense that
// matters to the user — its own nav section — but shares the same sidebar
// component and Clerk org/session, not a distinct login. If a real operator
// hasn't been set up yet, bounce to /dashboard rather than duplicating
// (app)/layout.tsx's onboarding flow here.
export default async function OpsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const operator = await getCurrentOperator();
  if (!operator) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-row">
      <EscapeToBack />
      <AppSidebar />
      <main className="flex flex-1 flex-col overflow-x-hidden">{children}</main>
    </div>
  );
}
