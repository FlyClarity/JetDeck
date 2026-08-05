import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { getCurrentOperator } from "@/lib/operator";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

async function updateSettings(formData: FormData) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const logoUrl = String(formData.get("logoUrl") ?? "").trim() || null;
  const inboundEmail = String(formData.get("inboundEmail") ?? "").trim() || null;
  const wireInstructions = String(formData.get("wireInstructions") ?? "");
  const termsText = String(formData.get("termsText") ?? "");
  const replyToEmail = String(formData.get("replyToEmail") ?? "");
  const notifyEmail = String(formData.get("notifyEmail") ?? "").trim() || null;
  const fromEmail = String(formData.get("fromEmail") ?? "").trim() || null;
  const depositPercentInput = Number(formData.get("depositPercent") ?? 25);
  const depositPercent = Math.min(Math.max(depositPercentInput, 0), 100) / 100;
  const termsVersion = termsText
    ? createHash("sha256").update(termsText).digest("hex")
    : null;
  const defaultBlockTimeBufferHours = Number(formData.get("defaultBlockTimeBufferHours") ?? 0.2);
  const defaultOvernightFee = Number(formData.get("defaultOvernightFee") ?? 1500);

  await prisma.operator.update({
    where: { clerkOrgId },
    data: {
      logoUrl,
      inboundEmail,
      wireInstructions,
      termsText,
      termsVersion,
      replyToEmail,
      notifyEmail,
      fromEmail,
      depositPercent,
      defaultBlockTimeBufferHours,
      defaultOvernightFee,
    },
  });

  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const operator = await getCurrentOperator();

  if (!operator) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-muted-foreground">{operator.name}</p>

      <form action={updateSettings} className="mt-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="logoUrl">Logo URL</Label>
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            defaultValue={operator.logoUrl ?? ""}
            placeholder="https://youroperator.com/logo.png"
          />
          <p className="text-sm text-muted-foreground">
            Shown at the top of the client quote page. Paste a link to a hosted image — file
            upload isn&apos;t built yet.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="wireInstructions">Wire instructions</Label>
          <Textarea
            id="wireInstructions"
            name="wireInstructions"
            defaultValue={operator.wireInstructions ?? ""}
            placeholder="Shown to clients on confirmed bookings"
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="termsText">Charter terms & conditions</Label>
          <Textarea
            id="termsText"
            name="termsText"
            defaultValue={operator.termsText ?? ""}
            placeholder="Shown on the client quote page above the accept button"
            rows={8}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="depositPercent">Deposit percentage</Label>
          <Input
            id="depositPercent"
            name="depositPercent"
            type="number"
            min={0}
            max={100}
            step={1}
            defaultValue={Math.round(operator.depositPercent * 100)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fromEmail">From address</Label>
          <Input
            id="fromEmail"
            name="fromEmail"
            type="email"
            defaultValue={operator.fromEmail ?? ""}
            placeholder="charter@youroperator.com"
          />
          <p className="text-sm text-muted-foreground">
            Sender address on outbound email. Must be on a domain verified in
            Resend, or delivery will fail — leave blank to use the app
            default.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="replyToEmail">Reply-to address</Label>
          <Input
            id="replyToEmail"
            name="replyToEmail"
            type="email"
            defaultValue={operator.replyToEmail ?? ""}
            placeholder="charter@youroperator.com"
          />
          <p className="text-sm text-muted-foreground">
            Client replies to quote emails route back through JetDeck via
            this address.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notifyEmail">Internal notification email</Label>
          <Input
            id="notifyEmail"
            name="notifyEmail"
            type="email"
            defaultValue={operator.notifyEmail ?? ""}
            placeholder="ops@youroperator.com"
          />
          <p className="text-sm text-muted-foreground">
            Where JetDeck sends alerts — quote accepted/declined, change
            requests, and general inquiries.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="defaultBlockTimeBufferHours">Block time buffer (hrs/leg)</Label>
            <Input
              id="defaultBlockTimeBufferHours"
              name="defaultBlockTimeBufferHours"
              type="number"
              min={0}
              step="0.1"
              defaultValue={operator.defaultBlockTimeBufferHours}
            />
            <p className="text-sm text-muted-foreground">
              Added to each leg&apos;s flight time for climb/descent/taxi.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="defaultOvernightFee">Overnight fee ($/night)</Label>
            <Input
              id="defaultOvernightFee"
              name="defaultOvernightFee"
              type="number"
              min={0}
              step="0.01"
              defaultValue={operator.defaultOvernightFee}
            />
            <p className="text-sm text-muted-foreground">
              Applied when the aircraft doesn&apos;t return to home base.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="inboundEmail">Inbound email address</Label>
          <Input
            id="inboundEmail"
            name="inboundEmail"
            type="email"
            defaultValue={operator.inboundEmail ?? ""}
            placeholder="you@inbound.postmarkapp.com"
          />
          <p className="text-sm text-muted-foreground">
            Forward or set up mail routing to this address to feed the AI
            triage pipeline. Must exactly match the address Postmark
            delivers inbound mail to.
          </p>
        </div>

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>
    </div>
  );
}
