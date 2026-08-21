import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

  redirect("/sourcing");
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

  const updateWithId = updatePreferredOperator.bind(null, preferredOperator.id);
  const deleteWithId = deletePreferredOperator.bind(null, preferredOperator.id);

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{preferredOperator.name}</h1>

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
