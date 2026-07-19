import { CreateOrganization, OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { getTenantContext } from "@/lib/auth";

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

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <span className="text-sm font-semibold tracking-wide text-primary">
          JETDECK
        </span>
        <div className="flex items-center gap-4">
          <OrganizationSwitcher />
          <UserButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
