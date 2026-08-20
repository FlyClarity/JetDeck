import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import {
  confirmPendingBookingForOperator,
  declinePendingBookingForOperator,
} from "@/lib/booking-server";
import { TRIP_PURPOSE_LABELS } from "@/lib/quote";
import { revenueLegsOf } from "@/lib/itinerary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createTripRequestFromInboundEmail,
  logInboundEmailAsInquiry,
  type InboundEmailWithOperator,
} from "@/lib/ai/process-inbound-email";

async function getScopedInboundEmail(id: string): Promise<InboundEmailWithOperator | null> {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return null;

  return prisma.inboundEmail.findFirst({
    where: { id, operatorId: operator.id },
    include: { operator: true },
  });
}

async function markReviewed(id: string, correctedAction: string) {
  const { userId } = await getTenantContext();
  await prisma.inboundEmail.update({
    where: { id },
    data: { reviewedBy: userId, reviewedAt: new Date(), correctedAction },
  });
}

async function createTripRequestAction(id: string) {
  "use server";
  const inboundEmail = await getScopedInboundEmail(id);
  if (!inboundEmail) return;

  const tripRequest = await createTripRequestFromInboundEmail(inboundEmail);
  await markReviewed(id, "create_trip_request");
  revalidatePath("/inbox/review");
  redirect(`/dashboard?open=${tripRequest.id}`);
}

async function logAsInquiryAction(id: string) {
  "use server";
  const inboundEmail = await getScopedInboundEmail(id);
  if (!inboundEmail) return;

  await logInboundEmailAsInquiry(inboundEmail);
  await markReviewed(id, "log_as_inquiry");
  revalidatePath("/inbox/review");
}

async function discardAction(id: string) {
  "use server";
  const inboundEmail = await getScopedInboundEmail(id);
  if (!inboundEmail) return;

  await prisma.inboundEmail.update({ where: { id }, data: { status: "discarded" } });
  await markReviewed(id, "discard");
  revalidatePath("/inbox/review");
}

async function attachToQuoteAction(id: string, formData: FormData) {
  "use server";
  const inboundEmail = await getScopedInboundEmail(id);
  if (!inboundEmail) return;

  const quoteNumber = String(formData.get("quoteNumber") ?? "").trim();
  if (!quoteNumber) return;

  const quote = await prisma.quote.findFirst({
    where: { operatorId: inboundEmail.operatorId, quoteNumber },
  });
  if (!quote) return;

  await prisma.inboundEmail.update({
    where: { id },
    data: { status: "attached_to_quote", quoteId: quote.id },
  });
  await markReviewed(id, "attach_to_quote");
  revalidatePath("/inbox/review");
}

async function sendToOpsAction(id: string) {
  "use server";
  const operator = await getCurrentOperator();
  if (!operator) return;

  await prisma.trip.updateMany({
    where: { id, operatorId: operator.id },
    data: { sentToOps: true },
  });
  revalidatePath("/inbox/review");
}

async function confirmPendingBookingAction(id: string) {
  "use server";
  const operator = await getCurrentOperator();
  if (!operator) return;

  await confirmPendingBookingForOperator(operator.id, id);
  revalidatePath("/inbox/review");
}

async function declinePendingBookingAction(id: string, formData: FormData) {
  "use server";
  const operator = await getCurrentOperator();
  if (!operator) return;

  const note = String(formData.get("declineNote") ?? "").trim();
  await declinePendingBookingForOperator(operator.id, id, note);
  revalidatePath("/inbox/review");
}

export default async function NeedsReviewPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const [emails, pendingQuotes, readyForOps] = await Promise.all([
    prisma.inboundEmail.findMany({
      where: { operatorId: operator.id, status: "needs_review" },
      orderBy: { receivedAt: "desc" },
    }),
    prisma.quote.findMany({
      where: { operatorId: operator.id, status: "pending_confirmation" },
      include: { tripRequest: true },
      orderBy: { acceptedAt: "desc" },
    }),
    prisma.trip.findMany({
      where: {
        operatorId: operator.id,
        sentToOps: false,
        status: { notIn: ["cancelled", "cancelled_by_operator"] },
      },
      include: { quote: { include: { tripRequest: true, selectedOption: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Needs Review</h1>
      <p className="mt-1 text-muted-foreground">
        Emails the AI couldn&apos;t confidently triage, bookings waiting on your
        confirmation, and confirmed trips ready to hand off to ops. Goal: keep this at zero.
      </p>

      {emails.length === 0 && pendingQuotes.length === 0 && readyForOps.length === 0 ? (
        <p className="mt-8 text-muted-foreground">Nothing waiting — you&apos;re caught up.</p>
      ) : (
        <>
          {readyForOps.length > 0 && (
            <div className="mt-8 flex flex-col gap-6">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Ready for ops
              </h2>
              {readyForOps.map((trip) => {
                const sendAction = sendToOpsAction.bind(null, trip.id);
                const legs = revenueLegsOf(trip.quote.selectedOption?.itinerary);
                const firstLeg = legs[0];
                const lastLeg = legs[legs.length - 1];
                const route = firstLeg
                  ? `${firstLeg.depAirport ?? "?"} → ${lastLeg?.arrAirport ?? "?"}`
                  : "Route unknown";
                const clientName = trip.quote.tripRequest?.requestorName;

                return (
                  <div key={trip.id} className="rounded-md border border-border p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {trip.tripNumber}
                          {clientName && (
                            <span className="font-normal text-muted-foreground"> · {clientName}</span>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">{route}</p>
                      </div>
                      <Link
                        href={`/quotes/${trip.quote.id}`}
                        className="shrink-0 text-sm text-foreground underline underline-offset-4"
                      >
                        View quote
                      </Link>
                    </div>
                    <form action={sendAction} className="mt-4">
                      <Button type="submit" size="sm">
                        Send to Ops
                      </Button>
                    </form>
                  </div>
                );
              })}
            </div>
          )}

          {pendingQuotes.length > 0 && (
            <div className="mt-8 flex flex-col gap-6">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Bookings needing confirmation
              </h2>
              {pendingQuotes.map((quote) => {
                const confirmAction = confirmPendingBookingAction.bind(null, quote.id);
                const declineAction = declinePendingBookingAction.bind(null, quote.id);

                return (
                  <div
                    key={quote.id}
                    className="rounded-md border border-destructive/40 bg-destructive/5 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {quote.quoteNumber}{" "}
                          <span className="font-normal text-muted-foreground">
                            ·{" "}
                            {quote.tripRequest
                              ? quote.tripRequest.requestorName
                              : (quote.tripPurpose && TRIP_PURPOSE_LABELS[quote.tripPurpose]) ??
                                "Internal"}
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {quote.tripRequest?.requestorName || "The client"} requested to book
                          {quote.requestedAt && ` on ${quote.requestedAt.toLocaleString()}`} —
                          needs your review
                        </p>
                      </div>
                      <Link
                        href={`/quotes/${quote.id}`}
                        className="shrink-0 text-sm text-foreground underline underline-offset-4"
                      >
                        View quote
                      </Link>
                    </div>

                    {quote.conflictWarning && (
                      <p className="mt-3 text-sm text-destructive">
                        ⚠️ {quote.conflictWarning}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <form action={confirmAction}>
                        <Button type="submit" size="sm">
                          Confirm Availability
                        </Button>
                      </form>
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          Decline instead
                        </summary>
                        <form action={declineAction} className="mt-3 flex flex-col gap-2">
                          <Textarea
                            name="declineNote"
                            rows={2}
                            placeholder="Reason — this is sent to the client"
                            required
                          />
                          <Button type="submit" variant="destructive" size="sm" className="self-start">
                            Decline
                          </Button>
                        </form>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {emails.length > 0 && (
            <div className="mt-8 flex flex-col gap-6">
              {(readyForOps.length > 0 || pendingQuotes.length > 0) && (
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Emails
                </h2>
              )}
              {emails.map((email) => {
                const createAction = createTripRequestAction.bind(null, email.id);
                const inquiryAction = logAsInquiryAction.bind(null, email.id);
                const discardEmailAction = discardAction.bind(null, email.id);
                const attachAction = attachToQuoteAction.bind(null, email.id);

                return (
                  <div key={email.id} className="rounded-md border border-border p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {email.fromName ?? email.fromEmail}{" "}
                          <span className="font-normal text-muted-foreground">
                            &lt;{email.fromEmail}&gt;
                          </span>
                        </p>
                        {email.replyToEmail && (
                          <p className="text-sm text-muted-foreground">
                            Reply-To: {email.replyToEmail}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {email.subject || "(no subject)"}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {email.receivedAt.toLocaleString()}
                      </span>
                    </div>

                    {email.classificationReason && (
                      <p className="mt-2 text-sm text-muted-foreground italic">
                        AI: {email.classification} ({email.classificationConfidence}) —{" "}
                        {email.classificationReason}
                      </p>
                    )}

                    <pre className="mt-3 max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
                      {email.bodyText}
                    </pre>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <form action={createAction}>
                        <Button type="submit" size="sm" variant="outline">
                          Create Trip Request
                        </Button>
                      </form>
                      <form action={inquiryAction}>
                        <Button type="submit" size="sm" variant="outline">
                          Log as Inquiry
                        </Button>
                      </form>
                      <form action={discardEmailAction}>
                        <Button type="submit" size="sm" variant="outline">
                          Discard
                        </Button>
                      </form>
                      <form action={attachAction} className="flex items-center gap-2">
                        <Input
                          name="quoteNumber"
                          placeholder="Q-2024-0042"
                          className="h-8 w-36"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Attach to Quote
                        </Button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
