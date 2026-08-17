import Link from "next/link";
import { CreateOrganization, OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EscapeToBack } from "@/components/escape-to-back";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { clerkOrgId } = await getTenantContext();

  if (!clerkOrgId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <span className="text-sm font-medium tracking-wide text-accent">
          JETDECK
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up your operator
        </h1>
        <p className="max-w-md text-muted-foreground">
          JetDeck organizes everything around your operator. Create one to
          continue — you can invite your team afterward.
        </p>
        <CreateOrganization />
      </div>
    );
  }

  const operator = await prisma.operator.findUnique({
    where: { clerkOrgId },
  });

  const needsReviewCount = operator
    ? await Promise.all([
        prisma.inboundEmail.count({
          where: { operatorId: operator.id, status: "needs_review" },
        }),
        prisma.quote.count({
          where: { operatorId: operator.id, status: "pending_confirmation" },
        }),
      ]).then(([emailCount, pendingBookingCount]) => emailCount + pendingBookingCount)
    : 0;

  if (!operator) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <span className="text-sm font-medium tracking-wide text-accent">
          JETDECK
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Setting up your operator…
        </h1>
        <p className="max-w-md text-muted-foreground">
          This usually takes a few seconds. If this is the wrong organization,
          switch below.
        </p>
        <OrganizationSwitcher hidePersonal />
        <Link href="/dashboard" className="text-sm font-medium text-primary underline underline-offset-4">
          Refresh
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <EscapeToBack />
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <span className="text-sm font-semibold tracking-wide text-primary">
          JETDECK
        </span>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            href="/ops"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Ops →
          </Link>
          {operator.operatorType !== "broker" && (
            <Link
              href="/fleet"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Fleet
            </Link>
          )}
          <Link
            href="/contacts"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Contacts
          </Link>
          <Link
            href="/inbox/review"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Needs Review
            {needsReviewCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-foreground">
                {needsReviewCount}
              </span>
            )}
          </Link>
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
          <OrganizationSwitcher />
          <UserButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
