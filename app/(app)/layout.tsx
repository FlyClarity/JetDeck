import Link from "next/link";
import { CreateOrganization, OrganizationSwitcher } from "@clerk/nextjs";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EscapeToBack } from "@/components/escape-to-back";
import { AppHeader } from "@/components/app-header";

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
      <AppHeader needsReviewCount={needsReviewCount} showFleet={operator.operatorType !== "broker"} />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
