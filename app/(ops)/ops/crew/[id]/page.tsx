import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
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
import { CREW_ROLES } from "@/lib/crew";
import { AIRCRAFT_CATEGORIES, categoryLabel } from "@/lib/aircraft";
import { cn } from "@/lib/utils";

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
  const hireDateRaw = String(formData.get("hireDate") ?? "");
  const terminationDateRaw = String(formData.get("terminationDate") ?? "");
  const otherHoursQuarterlyRaw = String(formData.get("otherCommercialHoursQuarterly") ?? "");
  const otherHoursAnnualRaw = String(formData.get("otherCommercialHoursAnnual") ?? "");

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
      address: String(formData.get("address") ?? "").trim() || null,
      emergencyContactName: String(formData.get("emergencyContactName") ?? "").trim() || null,
      emergencyContactPhone: String(formData.get("emergencyContactPhone") ?? "").trim() || null,
      employmentType: String(formData.get("employmentType") ?? "").trim() || null,
      hireDate: hireDateRaw ? new Date(`${hireDateRaw}T00:00:00`) : null,
      terminationDate: terminationDateRaw ? new Date(`${terminationDateRaw}T00:00:00`) : null,
      otherCommercialHoursQuarterly: otherHoursQuarterlyRaw ? Number(otherHoursQuarterlyRaw) : null,
      otherCommercialHoursAnnual: otherHoursAnnualRaw ? Number(otherHoursAnnualRaw) : null,
      otherCommercialHoursAsOf:
        otherHoursQuarterlyRaw || otherHoursAnnualRaw ? new Date() : null,
    },
  });

  await logAction({
    operatorId,
    action: "crew.update",
    entityType: "CrewMember",
    entityId: id,
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

  await logAction({
    operatorId,
    action: "crew.delete",
    entityType: "CrewMember",
    entityId: id,
    detail: { name: existing.name },
  });

  redirect("/ops/crew");
}

// Additive record-keeping only this phase — see CrewCertificate's schema
// comment. Doesn't touch crewQualificationStatus (lib/crew.ts), which
// still reads medicalExpiry/trainingExpiry directly, unchanged.
async function addCrewCertificate(crewId: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;
  const crew = await prisma.crewMember.findFirst({ where: { id: crewId, operatorId } });
  if (!crew) return;

  const certType = String(formData.get("certType") ?? "").trim();
  if (!certType) return;
  const issuedAtRaw = String(formData.get("issuedAt") ?? "");
  const expiryRaw = String(formData.get("expiry") ?? "");

  const cert = await prisma.crewCertificate.create({
    data: {
      operatorId,
      crewId,
      certType,
      certNumber: String(formData.get("certNumber") ?? "").trim() || null,
      issuedAt: issuedAtRaw ? new Date(`${issuedAtRaw}T00:00:00`) : null,
      expiry: expiryRaw ? new Date(`${expiryRaw}T00:00:00`) : null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  await logAction({
    operatorId,
    action: "crew.certificate.create",
    entityType: "CrewCertificate",
    entityId: cert.id,
    detail: { crewId, certType },
  });

  revalidatePath(`/ops/crew/${crewId}`);
}

async function deleteCrewCertificate(crewId: string, certId: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;
  const cert = await prisma.crewCertificate.findFirst({ where: { id: certId, operatorId, crewId } });
  if (!cert) return;

  await prisma.crewCertificate.delete({ where: { id: certId } });

  await logAction({
    operatorId,
    action: "crew.certificate.delete",
    entityType: "CrewCertificate",
    entityId: certId,
    detail: { crewId, certType: cert.certType },
  });

  revalidatePath(`/ops/crew/${crewId}`);
}

// Upsert rather than a plain create — re-signing off the same category
// (e.g. after recurrent training) updates the existing row's qualifiedAt
// instead of accumulating duplicate rows, since @@unique([crewId,
// category]) means there's only ever one row per crew/category pair
// anyway.
async function addCrewQualification(crewId: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;
  const crew = await prisma.crewMember.findFirst({ where: { id: crewId, operatorId } });
  if (!crew) return;

  const category = String(formData.get("category") ?? "");
  if (!AIRCRAFT_CATEGORIES.some((c) => c.value === category)) return;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const qual = await prisma.crewQualification.upsert({
    where: { crewId_category: { crewId, category } },
    create: { operatorId, crewId, category, qualifiedAt: new Date(), notes },
    update: { qualifiedAt: new Date(), notes },
  });

  await logAction({
    operatorId,
    action: "crew.qualification.upsert",
    entityType: "CrewQualification",
    entityId: qual.id,
    detail: { crewId, category },
  });

  revalidatePath(`/ops/crew/${crewId}`);
}

async function deleteCrewQualification(crewId: string, qualId: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;
  const qual = await prisma.crewQualification.findFirst({ where: { id: qualId, operatorId, crewId } });
  if (!qual) return;

  await prisma.crewQualification.delete({ where: { id: qualId } });

  await logAction({
    operatorId,
    action: "crew.qualification.delete",
    entityType: "CrewQualification",
    entityId: qualId,
    detail: { crewId, category: qual.category },
  });

  revalidatePath(`/ops/crew/${crewId}`);
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

  const crew = await prisma.crewMember.findFirst({
    where: { id, operatorId },
    include: {
      certificates: { orderBy: { expiry: "asc" } },
      qualifications: { orderBy: { category: "asc" } },
    },
  });
  if (!crew) notFound();

  const updateWithId = updateCrewMember.bind(null, crew.id);
  const deleteWithId = deleteCrewMember.bind(null, crew.id);
  const addCertWithId = addCrewCertificate.bind(null, crew.id);
  const addQualWithId = addCrewQualification.bind(null, crew.id);

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
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Profile
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" name="address" rows={2} defaultValue={crew.address ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="emergencyContactName">Emergency contact name</Label>
              <Input
                id="emergencyContactName"
                name="emergencyContactName"
                defaultValue={crew.emergencyContactName ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emergencyContactPhone">Emergency contact phone</Label>
              <Input
                id="emergencyContactPhone"
                name="emergencyContactPhone"
                type="tel"
                defaultValue={crew.emergencyContactPhone ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="employmentType">Employment type</Label>
              <Select name="employmentType" defaultValue={crew.employmentType ?? undefined}>
                <SelectTrigger id="employmentType">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="w2">W-2 Employee</SelectItem>
                  <SelectItem value="1099">1099 Contractor</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hireDate">Hire date</Label>
              <Input
                id="hireDate"
                name="hireDate"
                type="date"
                defaultValue={crew.hireDate ? crew.hireDate.toISOString().slice(0, 10) : ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="terminationDate">Termination date</Label>
              <Input
                id="terminationDate"
                name="terminationDate"
                type="date"
                defaultValue={crew.terminationDate ? crew.terminationDate.toISOString().slice(0, 10) : ""}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Other commercial flying (Chief Pilot)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Self-reported hours flown for other operators — JetDeck has no visibility into these.
              Phase 2&apos;s duty/flight-time accumulator adds JetDeck-tracked hours on top of
              whichever of these is still within its window, for the 500/quarter, 800/2-quarter,
              and 1,400/year all-commercial-flying caps.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="otherCommercialHoursQuarterly">Hours this quarter</Label>
              <Input
                id="otherCommercialHoursQuarterly"
                name="otherCommercialHoursQuarterly"
                type="number"
                step="0.1"
                min="0"
                defaultValue={crew.otherCommercialHoursQuarterly ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="otherCommercialHoursAnnual">Hours this year</Label>
              <Input
                id="otherCommercialHoursAnnual"
                name="otherCommercialHoursAnnual"
                type="number"
                step="0.1"
                min="0"
                defaultValue={crew.otherCommercialHoursAnnual ?? ""}
              />
            </div>
          </div>
          {crew.otherCommercialHoursAsOf && (
            <p className="text-xs text-muted-foreground">
              Last updated {crew.otherCommercialHoursAsOf.toLocaleDateString()}.
            </p>
          )}
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

        <SaveButton className="self-start">Save</SaveButton>
      </form>

      <div className="mt-10 border-t border-border pt-6">
        <h2 className="text-lg font-semibold tracking-tight">Certificates</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Additional certificates/ratings beyond medical and training above — type ratings, first
          aid, etc.
        </p>
        {crew.certificates.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No certificates on file.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {crew.certificates.map((cert) => {
              const deleteCertWithId = deleteCrewCertificate.bind(null, crew.id, cert.id);
              const expired = cert.expiry && cert.expiry < new Date();
              return (
                <li
                  key={cert.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {cert.certType}
                      {cert.certNumber ? ` — ${cert.certNumber}` : ""}
                    </p>
                    <p className={cn("text-xs", expired ? "text-destructive" : "text-muted-foreground")}>
                      {cert.expiry ? `Expires ${cert.expiry.toLocaleDateString()}` : "No expiry"}
                      {cert.notes ? ` · ${cert.notes}` : ""}
                    </p>
                  </div>
                  <form action={deleteCertWithId}>
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
        <form action={addCertWithId} className="mt-4 flex flex-col gap-3 rounded-md border border-border p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="certType">Type</Label>
              <Input id="certType" name="certType" placeholder="e.g. Type Rating — CJ3" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="certNumber">Certificate number</Label>
              <Input id="certNumber" name="certNumber" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="issuedAt">Issued</Label>
              <Input id="issuedAt" name="issuedAt" type="date" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="expiry">Expires</Label>
              <Input id="expiry" name="expiry" type="date" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="certNotes">Notes</Label>
            <Input id="certNotes" name="notes" />
          </div>
          <Button type="submit" variant="outline" size="sm" className="self-start">
            Add Certificate
          </Button>
        </form>
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <h2 className="text-lg font-semibold tracking-tight">Aircraft Category Qualifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Data-only for now — not yet checked by Ops Review or trip assignment.
        </p>
        {crew.qualifications.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No category qualifications on file.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {crew.qualifications.map((qual) => {
              const deleteQualWithId = deleteCrewQualification.bind(null, crew.id, qual.id);
              return (
                <li
                  key={qual.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{categoryLabel(qual.category)}</p>
                    <p className="text-xs text-muted-foreground">
                      {qual.qualifiedAt ? `Qualified ${qual.qualifiedAt.toLocaleDateString()}` : "Qualified"}
                      {qual.notes ? ` · ${qual.notes}` : ""}
                    </p>
                  </div>
                  <form action={deleteQualWithId}>
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
        <form action={addQualWithId} className="mt-4 flex flex-col gap-3 rounded-md border border-border p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="category">Category</Label>
              <Select name="category">
                <SelectTrigger id="category">
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="qualNotes">Notes</Label>
              <Input id="qualNotes" name="notes" />
            </div>
          </div>
          <Button type="submit" variant="outline" size="sm" className="self-start">
            Add Qualification
          </Button>
        </form>
      </div>

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
