import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
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

async function getScopedOperatorId() {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  return operator?.id ?? null;
}

async function updateContact(id: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.contact.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  const paymentTerms = String(formData.get("paymentTerms") ?? "standard");

  await prisma.contact.update({
    where: { id },
    data: {
      firstName: String(formData.get("firstName") ?? "").trim(),
      lastName: String(formData.get("lastName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim() || null,
      company: String(formData.get("company") ?? "").trim() || null,
      type: String(formData.get("type") ?? "direct"),
      notes: String(formData.get("notes") ?? "").trim() || null,
      paymentTerms: ["standard", "cash_on_account"].includes(paymentTerms)
        ? paymentTerms
        : "standard",
    },
  });

  redirect(`/contacts/${id}?saved=1`);
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const contact = await prisma.contact.findFirst({
    where: { id, operatorId: operator.id },
  });
  if (!contact) notFound();

  const updateWithId = updateContact.bind(null, contact.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {contact.firstName} {contact.lastName}
        </h1>
        {saved === "1" && (
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-sm font-medium text-accent">
            Saved
          </span>
        )}
      </div>

      <form action={updateWithId} className="mt-8 flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" defaultValue={contact.firstName} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" defaultValue={contact.lastName} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={contact.email} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={contact.phone ?? ""} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="company">Company</Label>
            <Input id="company" name="company" defaultValue={contact.company ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="type">Type</Label>
            <Select name="type" defaultValue={contact.type}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct</SelectItem>
                <SelectItem value="broker">Broker</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <Label htmlFor="paymentTerms">Payment terms</Label>
          <Select name="paymentTerms" defaultValue={contact.paymentTerms}>
            <SelectTrigger id="paymentTerms">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard — card hold at booking</SelectItem>
              <SelectItem value="cash_on_account">Cash on account — waive card hold</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Cash-on-account skips the card hold entirely when this contact books — billed
            separately instead.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={contact.notes ?? ""}
            placeholder="Internal notes about this contact"
          />
        </div>

        <Button type="submit" className="self-start">
          Save Changes
        </Button>
      </form>
    </div>
  );
}
