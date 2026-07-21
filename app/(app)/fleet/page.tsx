import Link from "next/link";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { categoryLabel } from "@/lib/aircraft";

export default async function FleetPage() {
  const operator = await getCurrentOperator();

  if (!operator) {
    return null;
  }

  if (operator.operatorType === "broker") {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
        <p className="mt-2 text-muted-foreground">
          Fleet management isn&apos;t used on broker accounts — you source
          aircraft from your preferred operators instead.
        </p>
      </div>
    );
  }

  const aircraft = await prisma.aircraft.findMany({
    where: { operatorId: operator.id },
    orderBy: { tailNumber: "asc" },
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
        <Button asChild>
          <Link href="/fleet/new">Add Aircraft</Link>
        </Button>
      </div>

      {aircraft.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          No aircraft yet. Add your first tail to start tracking positioning
          and pricing.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Tail</th>
                <th className="py-2 pr-4 font-medium">Aircraft</th>
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 font-medium">Home Base</th>
                <th className="py-2 pr-4 font-medium">Current Base</th>
                <th className="py-2 pr-4 font-medium">Hourly Rate</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {aircraft.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 font-medium">{a.tailNumber}</td>
                  <td className="py-3 pr-4">
                    {a.make} {a.model}
                  </td>
                  <td className="py-3 pr-4">{categoryLabel(a.category)}</td>
                  <td className="py-3 pr-4">{a.homeBase}</td>
                  <td className="py-3 pr-4">{a.currentBase ?? "—"}</td>
                  <td className="py-3 pr-4">${a.hourlyRate.toLocaleString()}/hr</td>
                  <td className="py-3 pr-4 capitalize">{a.status}</td>
                  <td className="py-3 pr-4 text-right">
                    <Link
                      href={`/fleet/${a.id}`}
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
