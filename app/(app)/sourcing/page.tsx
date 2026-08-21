import Link from "next/link";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

export default async function SourcingPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const preferredOperators = await prisma.preferredOperator.findMany({
    where: { operatorId: operator.id },
    include: { _count: { select: { brokeredAircraft: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sourcing</h1>
          <p className="mt-1 text-muted-foreground">
            Third-party operators you charter aircraft from when a trip needs an off-fleet
            tail — quoted at a wholesale cost you mark up, not your own fleet&apos;s rates.
          </p>
        </div>
        <Button asChild>
          <Link href="/sourcing/new">Add Preferred Operator</Link>
        </Button>
      </div>

      {preferredOperators.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          No preferred operators yet. Add one to start sourcing aircraft outside your own fleet.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Contact</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Aircraft</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {preferredOperators.map((po) => (
                <tr key={po.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/sourcing/${po.id}`}
                      className="font-medium hover:underline hover:underline-offset-4"
                    >
                      {po.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{po.contactName ?? "—"}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{po.contactEmail}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {po._count.brokeredAircraft}
                  </td>
                  <td className="py-3 pr-4">
                    {po.isActive ? (
                      <span className="text-xs text-muted-foreground">Active</span>
                    ) : (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <Link
                      href={`/sourcing/${po.id}`}
                      className="text-sm font-medium text-primary underline underline-offset-4"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
