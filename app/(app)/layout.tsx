import Link from "next/link";
import { CreateOrganization, OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
          This usually takes a few seconds.
        </p>
        <Link href="/dashboard" className="text-sm font-medium text-primary underline underline-offset-4">
          Refresh
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
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
          {operator.operatorType !== "broker" && (
            <Link
              href="/fleet"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Fleet
            </Link>
          )}
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
