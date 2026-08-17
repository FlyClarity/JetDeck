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

  await prisma.crewMember.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? ""),
      role: String(formData.get("role") ?? "captain"),
      email: formData.get("email") ? String(formData.get("email")) : null,
      phone: formData.get("phone") ? String(formData.get("phone")) : null,
      active: formData.get("active") === "on",
    },
  });

  redirect("/ops/crew");
}

export default async function CrewMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operatorId = await getScopedOperatorId();
  if (!operatorId) notFound();

  const crew = await prisma.crewMember.findFirst({ where: { id, operatorId } });
  if (!crew) notFound();

  const updateWithId = updateCrewMember.bind(null, crew.id);

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{crew.name}</h1>

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

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>
    </div>
  );
}
