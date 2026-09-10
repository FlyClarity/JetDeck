import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { QuoteQueue } from "@/components/queue/quote-queue";
import { expireStaleRequestsAndQuotes } from "@/lib/expire-stale";

async function passTripRequest(id: string) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const tripRequest = await prisma.tripRequest.findFirst({
    where: { id, operatorId: operator.id },
  });
  if (!tripRequest) return;

  await prisma.tripRequest.update({
    where: { id },
    data: { status: "passed", recommendedAction: "pass" },
  });

  revalidatePath("/dashboard");
}

async function deleteDraftQuote(id: string) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const quote = await prisma.quote.findFirst({
    where: { id, operatorId: operator.id, status: "draft" },
  });
  if (!quote) return;

  await prisma.quote.delete({ where: { id } });

  // If that was the only quote on its trip request, the lead is quotable
  // again — surface it back in Ready to Quote instead of leaving it stuck
  // showing "quoted" with nothing behind it.
  if (quote.tripRequestId) {
    const remaining = await prisma.quote.count({ where: { tripRequestId: quote.tripRequestId } });
    if (remaining === 0) {
      await prisma.tripRequest.update({
        where: { id: quote.tripRequestId },
        data: { status: "ready" },
      });
    }
  }

  revalidatePath("/dashboard");
}

async function declineQuote(id: string) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const quote = await prisma.quote.findFirst({
    where: { id, operatorId: operator.id, status: "sent" },
  });
  if (!quote) return;

  await prisma.quote.update({
    where: { id },
    data: { status: "declined", declinedAt: new Date() },
  });

  revalidatePath("/dashboard");
}

export default async function DashboardPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  // Capped rather than unbounded — this fetches on every page load and every
  // 30s dashboard poll (see quote-queue.tsx), so without a limit the payload
  // (and Neon data-transfer usage) grows forever as history accumulates,
  // even though the queue's tabs only ever need recent/active items in
  // practice. 500 is generous headroom over realistic day-to-day volume;
  // revisit with real pagination if an operator's active (non-passed,
  // non-terminal) volume ever approaches it.
  const RECENT_LIMIT = 500;

  // Self-heals regardless of whether the daily cron actually ran — scoped to
  // this operator alone so it stays cheap on every page load/poll, rather
  // than re-scanning every operator the way the cron's own sweep does.
  await expireStaleRequestsAndQuotes(operator.id);

  const tripRequests = await prisma.tripRequest.findMany({
    where: { operatorId: operator.id },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
  });

  const quotes = await prisma.quote.findMany({
    where: { operatorId: operator.id },
    include: { tripRequest: true, selectedOption: true },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
  });

  return (
    <QuoteQueue
      tripRequests={tripRequests}
      quotes={quotes}
      passAction={passTripRequest}
      deleteDraftAction={deleteDraftQuote}
      declineQuoteAction={declineQuote}
    />
  );
}
