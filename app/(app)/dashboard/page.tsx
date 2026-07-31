import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { QuoteQueue } from "@/components/queue/quote-queue";

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

  const tripRequests = await prisma.tripRequest.findMany({
    where: { operatorId: operator.id },
    orderBy: { createdAt: "desc" },
  });

  const quotes = await prisma.quote.findMany({
    where: { operatorId: operator.id },
    include: { tripRequest: true },
    orderBy: { createdAt: "desc" },
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
