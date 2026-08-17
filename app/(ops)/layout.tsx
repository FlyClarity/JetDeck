import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { getCurrentOperator } from "@/lib/operator";
import { EscapeToBack } from "@/components/escape-to-back";

// Structurally separate from the sales-side (app) layout — its own nav,
// its own header — but still the same Clerk org/session, not a distinct
// login. If a real operator hasn't been set up yet, bounce to /dashboard
// rather than duplicating (app)/layout.tsx's onboarding flow here.
export default async function OpsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const operator = await getCurrentOperator();
  if (!operator) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col">
      <EscapeToBack />
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-wide text-primary">
            JETDECK OPS
          </span>
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Sales
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/ops/trips"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Trips
          </Link>
          <OrganizationSwitcher />
          <UserButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
