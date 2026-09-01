import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CREW_ROLES } from "@/lib/crew";

async function getScopedOperatorId() {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  return operator?.id ?? null;
}

async function updateCrewMember(id: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;
  const existing = await prisma.crewMember.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  const medicalExpiryRaw = String(formData.get("medicalExpiry") ?? "");
  const trainingExpiryRaw = String(formData.get("trainingExpiry") ?? "");

  await prisma.crewMember.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? ""),
      role: String(formData.get("role") ?? "captain"),
      email: formData.get("email") ? String(formData.get("email")) : null,
      phone: formData.get("phone") ? String(formData.get("phone")) : null,
      active: formData.get("active") === "on",
      qualified: formData.get("qualified") === "on",
      medicalExpiry: medicalExpiryRaw ? new Date(`${medicalExpiryRaw}T00:00:00`) : null,
      trainingExpiry: trainingExpiryRaw ? new Date(`${trainingExpiryRaw}T00:00:00`) : null,
    },
  });

  redirect("/ops/crew");
}

// Only allowed when the crew member has never actually been assigned to a
// trip — TripCrewAssignment is a real flight record (roleOnTrip snapshots
// history), not something to silently cascade-delete. A crew member who
// has flown gets marked Inactive instead of removed outright.
async function deleteCrewMember(id: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;
  const existing = await prisma.crewMember.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  const assignmentCount = await prisma.tripCrewAssignment.count({ where: { crewId: id } });
  if (assignmentCount > 0) {
    redirect(`/ops/crew/${id}?error=assigned`);
  }

  await prisma.crewMember.delete({ where: { id } });
  redirect("/ops/crew");
}

export default async function CrewMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const operatorId = await getScopedOperatorId();
  if (!operatorId) notFound();

  const crew = await prisma.crewMember.findFirst({ where: { id, operatorId } });
  if (!crew) notFound();

  const updateWithId = updateCrewMember.bind(null, crew.id);
  const deleteWithId = deleteCrewMember.bind(null, crew.id);

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{crew.name}</h1>

      {error === "assigned" && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Can&apos;t delete {crew.name} — they&apos;re already assigned to at least one trip. Mark them
          Inactive instead to keep the flight history.
        </div>
      )}

      <form action={updateWithId} className="mt-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={crew.name} required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="role">Role</Label>
          <Select name="role" defaultValue={crew.role}>
            <SelectTrigger id="role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREW_ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={crew.email ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={crew.phone ?? ""} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="active"
            name="active"
            type="checkbox"
            defaultChecked={crew.active}
            className="size-4 rounded border-input"
          />
          <Label htmlFor="active" className="font-normal">
            Active (available to assign to trips)
          </Label>
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Qualification (Chief Pilot)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Only meaningful for Captain/First Officer — flight attendants and other crew aren&apos;t
              subject to flight/duty rules and aren&apos;t checked by Ops Review.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="qualified"
              name="qualified"
              type="checkbox"
              defaultChecked={crew.qualified}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="qualified" className="font-normal">
              Qualified to fly (currency, training, and company requirements reviewed)
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="medicalExpiry">Medical expires</Label>
              <Input
                id="medicalExpiry"
                name="medicalExpiry"
                type="date"
                defaultValue={crew.medicalExpiry ? crew.medicalExpiry.toISOString().slice(0, 10) : ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="trainingExpiry">Training due</Label>
              <Input
                id="trainingExpiry"
                name="trainingExpiry"
                type="date"
                defaultValue={crew.trainingExpiry ? crew.trainingExpiry.toISOString().slice(0, 10) : ""}
              />
            </div>
          </div>
        </div>

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>

      <details className="mt-8 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Delete this crew member?</summary>
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-muted-foreground">
            Only possible if they&apos;ve never been assigned to a trip. This can&apos;t be undone.
          </p>
          <form action={deleteWithId}>
            <Button type="submit" variant="destructive" size="sm">
              Delete {crew.name}
            </Button>
          </form>
        </div>
      </details>
    </div>
  );
}
