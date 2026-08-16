import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { getCurrentOperator } from "@/lib/operator";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/url";
import {
  createConnectedAccount,
  createConnectOnboardingLink,
  createConnectDashboardLoginLink,
} from "@/lib/stripe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyLinkButton } from "@/components/quote/copy-link-button";

async function startStripeOnboarding() {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  let accountId = operator.stripeAccountId;
  if (!accountId) {
    accountId = await createConnectedAccount({ name: operator.name, email: operator.notifyEmail });
    if (!accountId) redirect("/settings?stripe_error=1");
    await prisma.operator.update({ where: { id: operator.id }, data: { stripeAccountId: accountId } });
  }

  const appUrl = await getAppUrl();
  const onboardingUrl = await createConnectOnboardingLink(
    accountId,
    `${appUrl}/settings?stripe_refresh=1`,
    `${appUrl}/settings?stripe_return=1`
  );
  if (!onboardingUrl) redirect("/settings?stripe_error=1");

  redirect(onboardingUrl);
}

async function openStripeDashboard() {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator?.stripeAccountId) return;

  const loginUrl = await createConnectDashboardLoginLink(operator.stripeAccountId);
  if (!loginUrl) return;

  redirect(loginUrl);
}

async function updateSettings(formData: FormData) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

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
  const ccProcessingFeePercentInput = Number(formData.get("ccProcessingFeePercent") ?? 3);
  const ccProcessingFeePercent = Math.min(Math.max(ccProcessingFeePercentInput, 0), 100);

  await prisma.operator.update({
    where: { clerkOrgId },
    data: {
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
      ccProcessingFeePercent,
    },
  });

  redirect("/settings?saved=1");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; stripe_error?: string }>;
}) {
  const operator = await getCurrentOperator();
  const { saved, stripe_error: stripeError } = await searchParams;

  if (!operator) {
    return null;
  }

  const appUrl = await getAppUrl();
  const intakeUrl = `${appUrl}/intake/${operator.slug}`;
  const iframeEmbed = `<iframe src="${intakeUrl}" style="width:100%;max-width:640px;height:900px;border:0;" title="Request a Charter — ${operator.name}"></iframe>`;
  const linkEmbed = `<a href="${intakeUrl}" target="_blank" rel="noopener">Request a Quote</a>`;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        {saved === "1" && (
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-sm font-medium text-accent">
            Saved
          </span>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-md border border-border p-3">
        {operator.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={operator.logoUrl} alt={operator.name} className="h-8 w-auto" />
        )}
        <div>
          <p className="text-sm font-medium">{operator.name}</p>
          <p className="text-xs text-muted-foreground">
            Name and logo shown to clients — managed in your organization
            profile (the org switcher in the header, top right), not here.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-md border border-border p-4">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Payments
        </h2>
        {stripeError === "1" && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            Couldn&apos;t reach Stripe to connect your account. Check that JetDeck&apos;s Stripe
            key is configured correctly and try again — contact support if it keeps happening.
          </p>
        )}
        {operator.stripeChargesEnabled ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-medium text-accent">✓ Stripe connected</span> — client card
              hold deposits go directly to your own Stripe account.
            </p>
            <form action={openStripeDashboard}>
              <Button type="submit" variant="outline" size="sm">
                Open Stripe Dashboard
              </Button>
            </form>
          </div>
        ) : operator.stripeAccountId ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Stripe onboarding started but not finished — until it&apos;s complete, card hold
              deposits fall back to JetDeck&apos;s account instead of yours.
            </p>
            <form action={startStripeOnboarding}>
              <Button type="submit" size="sm">
                Finish Stripe Onboarding
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Connect your own Stripe account so client card hold deposits go directly to you,
              not JetDeck.
            </p>
            <form action={startStripeOnboarding}>
              <Button type="submit" size="sm">
                Connect Stripe
              </Button>
            </form>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-md border border-border p-4">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Website Widget
        </h2>
        <p className="text-sm text-muted-foreground">
          Add a &quot;Request a Charter&quot; form to your own website — clients submit trip
          requests directly into JetDeck instead of emailing you.
        </p>

        <div className="flex flex-col gap-2">
          <Label>Direct link</Label>
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <code className="flex-1 truncate text-sm">{intakeUrl}</code>
            <CopyLinkButton link={intakeUrl} />
          </div>
          <p className="text-sm text-muted-foreground">
            Simplest option — link a &quot;Request a Quote&quot; button on your site straight to
            this URL.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Embed as a button or text link</Label>
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <code className="flex-1 text-sm break-all">{linkEmbed}</code>
            <CopyLinkButton link={linkEmbed} className="shrink-0" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Embed the form directly on the page (iframe)</Label>
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <code className="flex-1 text-sm break-all">{iframeEmbed}</code>
            <CopyLinkButton link={iframeEmbed} className="shrink-0" />
          </div>
          <p className="text-sm text-muted-foreground">
            Paste this into an HTML/embed block on your site (works on WordPress, Squarespace,
            Wix, Webflow, or any platform that allows raw HTML). Adjust the width/height to fit
            your page.
          </p>
        </div>
      </div>

      <form action={updateSettings} className="mt-6 flex flex-col gap-6">
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
          <Label htmlFor="ccProcessingFeePercent">Credit card processing fee (%)</Label>
          <Input
            id="ccProcessingFeePercent"
            name="ccProcessingFeePercent"
            type="number"
            min={0}
            max={100}
            step="0.1"
            defaultValue={operator.ccProcessingFeePercent}
          />
          <p className="text-sm text-muted-foreground">
            Added to the deposit when a client chooses to pay by credit card instead of wire.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fromEmail">From address</Label>
          <Input
            id="fromEmail"
            name="fromEmail"
            type="email"
            defaultValue={operator.fromEmail ?? ""}
            placeholder="quotes@outbound.youroperator.com"
          />
          <p className="text-sm text-muted-foreground">
            Technical sending address — must be on a domain verified in
            Resend, or delivery will fail. Clients don&apos;t see this in
            practice: outbound email shows your operator name, and replies go
            to the Reply-to address below regardless of what this is set to.
            Leave blank to use the app default.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="replyToEmail">Reply-to address</Label>
          <Input
            id="replyToEmail"
            name="replyToEmail"
            type="email"
            defaultValue={operator.replyToEmail ?? ""}
            placeholder="quotes@youroperator.com"
          />
          <p className="text-sm text-muted-foreground">
            Your real charter inbox. When a client hits reply on a JetDeck
            email, it lands here — set this to the same mailbox you&apos;re
            forwarding to the inbound address below, so replies flow back
            into JetDeck automatically too.
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
            placeholder="quotes@inbound.youroperator.com"
          />
          <p className="text-sm text-muted-foreground">
            Set up an auto-forward rule in your real charter inbox (the
            Reply-to address above) pointing to this address — it&apos;s
            never given out to clients, just where your own inbox silently
            copies mail so JetDeck&apos;s AI triage pipeline can see it. Must
            exactly match the address Postmark delivers inbound mail to.
          </p>
        </div>

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>
    </div>
  );
}
