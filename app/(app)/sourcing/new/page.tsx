import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

async function createPreferredOperator(formData: FormData) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const contactEmail = String(formData.get("contactEmail") ?? "").trim();
  if (!contactEmail) return;

  const preferredOperator = await prisma.preferredOperator.create({
    data: {
      operatorId: operator.id,
      name: String(formData.get("name") ?? "").trim(),
      contactName: String(formData.get("contactName") ?? "").trim() || null,
      contactEmail,
      contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  redirect(`/sourcing/${preferredOperator.id}`);
}

export default async function NewPreferredOperatorPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Add Preferred Operator</h1>
      <p className="mt-1 text-muted-foreground">
        A third-party operator you can source aircraft from for an off-fleet trip.
      </p>

      <form action={createPreferredOperator} className="mt-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Company name</Label>
          <Input id="name" name="name" placeholder="East Coast Jets" required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="contactName">Contact name</Label>
            <Input id="contactName" name="contactName" placeholder="Jamie Rivera" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contactPhone">Contact phone</Label>
            <Input id="contactPhone" name="contactPhone" type="tel" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="contactEmail">Contact email</Label>
          <Input id="contactEmail" name="contactEmail" type="email" required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            placeholder="e.g. Great King Airs, reliable, responds fast"
          />
        </div>

        <Button type="submit" className="self-start">
          Add Preferred Operator
        </Button>
      </form>
    </div>
  );
}
