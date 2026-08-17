import Link from "next/link";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { crewRoleLabel } from "@/lib/crew";
import { Button } from "@/components/ui/button";

export default async function CrewPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const crew = await prisma.crewMember.findMany({
    where: { operatorId: operator.id },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Crew</h1>
          <p className="mt-1 text-muted-foreground">
            Pilots and crew available to assign to trips.
          </p>
        </div>
        <Button asChild>
          <Link href="/ops/crew/new">+ Add Crew Member</Link>
        </Button>
      </div>

      {crew.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          No crew on file yet — add your pilots and crew to start assigning them to trips.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Phone</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {crew.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4">
                    <Link href={`/ops/crew/${c.id}`} className="font-medium hover:underline hover:underline-offset-4">
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{crewRoleLabel(c.role)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="py-3 pr-4">
                    {c.active ? (
                      <span className="text-xs text-muted-foreground">Active</span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Inactive
                      </span>
                    )}
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
