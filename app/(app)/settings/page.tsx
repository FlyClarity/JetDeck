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

  const wireInstructions = String(formData.get("wireInstructions") ?? "");
  const termsText = String(formData.get("termsText") ?? "");
  const replyToEmail = String(formData.get("replyToEmail") ?? "");
  const depositPercentInput = Number(formData.get("depositPercent") ?? 25);
  const depositPercent = Math.min(Math.max(depositPercentInput, 0), 100) / 100;
  const termsVersion = termsText
    ? createHash("sha256").update(termsText).digest("hex")
    : null;

  await prisma.operator.update({
    where: { clerkOrgId },
    data: {
      wireInstructions,
      termsText,
      termsVersion,
      replyToEmail,
      depositPercent,
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
          <Label>Inbound email address</Label>
          <Input readOnly disabled value={operator.inboundEmail ?? ""} />
          <p className="text-sm text-muted-foreground">
            Forward your charter inbox to this address to feed the AI
            triage pipeline.
          </p>
        </div>

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>
    </div>
  );
}
