import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AIRCRAFT_CATEGORIES, categoryLabel } from "@/lib/aircraft";

async function getScopedOperatorId() {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  return operator?.id ?? null;
}

async function updatePreferredOperator(id: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.preferredOperator.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  const contactEmail = String(formData.get("contactEmail") ?? "").trim();
  if (!contactEmail) return;

  await prisma.preferredOperator.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      contactName: String(formData.get("contactName") ?? "").trim() || null,
      contactEmail,
      contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      isActive: formData.get("isActive") === "on",
    },
  });

  revalidatePath(`/sourcing/${id}`);
}

// Blocked (with a friendly redirect, not a raw FK error) once any brokered
// aircraft reference this preferred operator — mirrors the crew-delete
// pattern (see /ops/crew/[id]). Mark Inactive instead to keep it around for
// historical quotes/trips that already reference it, same reasoning as the
// crew page's own "mark Inactive instead" message.
async function deletePreferredOperator(id: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.preferredOperator.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  const aircraftCount = await prisma.brokeredAircraft.count({ where: { preferredOperatorId: id } });
  if (aircraftCount > 0) {
    redirect(`/sourcing/${id}?error=has_aircraft`);
  }

  await prisma.preferredOperator.delete({ where: { id } });
  redirect("/sourcing");
}

async function addBrokeredAircraft(preferredOperatorId: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const preferredOperator = await prisma.preferredOperator.findFirst({
    where: { id: preferredOperatorId, operatorId },
  });
  if (!preferredOperator) return;

  const tailNumber = String(formData.get("tailNumber") ?? "").trim().toUpperCase();
  if (!tailNumber) return;

  await prisma.brokeredAircraft.create({
    data: {
      operatorId,
      preferredOperatorId,
      tailNumber,
      make: String(formData.get("make") ?? "").trim() || null,
      model: String(formData.get("model") ?? "").trim() || null,
      category: String(formData.get("category") ?? "") || null,
      seats: formData.get("seats") ? Number(formData.get("seats")) : null,
      homeBase: String(formData.get("homeBase") ?? "").trim().toUpperCase() || null,
    },
  });

  revalidatePath(`/sourcing/${preferredOperatorId}`);
}

// Blocked once any quote has actually been built around this tail — a
// brokered tail referenced by a real quote is part of that quote's history,
// same reasoning as blocking a preferred-operator delete above. Nothing to
// "mark inactive" here instead since BrokeredAircraft has no such flag (it's
// a much lighter-weight record than a preferred operator) — just don't
// remove it while anything still points at it.
async function deleteBrokeredAircraft(preferredOperatorId: string, aircraftId: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.brokeredAircraft.findFirst({
    where: { id: aircraftId, operatorId, preferredOperatorId },
  });
  if (!existing) return;

  const quoteOptionCount = await prisma.quoteOption.count({ where: { brokeredAircraftId: aircraftId } });
  if (quoteOptionCount > 0) {
    redirect(`/sourcing/${preferredOperatorId}?error=aircraft_in_use`);
  }

  await prisma.brokeredAircraft.delete({ where: { id: aircraftId } });
  revalidatePath(`/sourcing/${preferredOperatorId}`);
}

export default async function PreferredOperatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const operatorId = await getScopedOperatorId();
  if (!operatorId) return null;

  const preferredOperator = await prisma.preferredOperator.findFirst({
    where: { id, operatorId },
  });
  if (!preferredOperator) notFound();

  const brokeredAircraft = await prisma.brokeredAircraft.findMany({
    where: { preferredOperatorId: preferredOperator.id },
    orderBy: { tailNumber: "asc" },
  });

  const updateWithId = updatePreferredOperator.bind(null, preferredOperator.id);
  const deleteWithId = deletePreferredOperator.bind(null, preferredOperator.id);
  const addAircraftWithId = addBrokeredAircraft.bind(null, preferredOperator.id);

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{preferredOperator.name}</h1>

      {error === "aircraft_in_use" && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Can&apos;t remove that tail — it&apos;s already on at least one quote.
        </div>
      )}

      {error === "has_aircraft" && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Can&apos;t delete {preferredOperator.name} — they have aircraft on file. Mark them
          Inactive instead to keep the history.
        </div>
      )}

      <form action={updateWithId} className="mt-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Company name</Label>
          <Input id="name" name="name" defaultValue={preferredOperator.name} required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="contactName">Contact name</Label>
            <Input
              id="contactName"
              name="contactName"
              defaultValue={preferredOperator.contactName ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contactPhone">Contact phone</Label>
            <Input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              defaultValue={preferredOperator.contactPhone ?? ""}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="contactEmail">Contact email</Label>
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={preferredOperator.contactEmail}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={preferredOperator.notes ?? ""}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="isActive"
            name="isActive"
            type="checkbox"
            defaultChecked={preferredOperator.isActive}
            className="size-4 rounded border-input"
          />
          <Label htmlFor="isActive" className="font-normal">
            Active — show when sourcing an aircraft for a quote
          </Label>
        </div>

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>

      <div className="mt-10">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Aircraft
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tails you can source from {preferredOperator.name} — selectable when building a quote
          with a brokered aircraft.
        </p>

        {brokeredAircraft.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {brokeredAircraft.map((a) => {
              const removeWithId = deleteBrokeredAircraft.bind(null, preferredOperator.id, a.id);
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{a.tailNumber}</span>
                    <span className="text-muted-foreground">
                      {" — "}
                      {[a.make, a.model].filter(Boolean).join(" ") || "Make/model not set"}
                      {a.category && ` · ${categoryLabel(a.category)}`}
                      {a.seats && ` · ${a.seats} seats`}
                      {a.homeBase && ` · ${a.homeBase}`}
                    </span>
                  </div>
                  <form action={removeWithId}>
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}

        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Add an aircraft</summary>
          <form action={addAircraftWithId} className="mt-3 flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="tailNumber">Tail number</Label>
                <Input id="tailNumber" name="tailNumber" placeholder="N12345" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="aircraftCategory">Category</Label>
                <Select name="category">
                  <SelectTrigger id="aircraftCategory">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {AIRCRAFT_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="make">Make</Label>
                <Input id="make" name="make" placeholder="Beechcraft" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="model">Model</Label>
                <Input id="model" name="model" placeholder="King Air 350" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="seats">Seats</Label>
                <Input id="seats" name="seats" type="number" min={1} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="aircraftHomeBase">Home base (ICAO)</Label>
                <Input id="aircraftHomeBase" name="homeBase" placeholder="KTEB" />
              </div>
            </div>
            <Button type="submit" size="sm" className="self-start">
              Add Aircraft
            </Button>
          </form>
        </details>
      </div>

      <details className="mt-8 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Delete this operator</summary>
        <form action={deleteWithId} className="mt-3">
          <p className="text-sm text-muted-foreground">
            Removes {preferredOperator.name} entirely. This can&apos;t be undone.
          </p>
          <Button type="submit" variant="destructive" size="sm" className="mt-2">
            Delete Preferred Operator
          </Button>
        </form>
      </details>
    </div>
  );
}
