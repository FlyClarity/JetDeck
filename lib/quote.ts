export type AdditionalFee = { label: string; amount: number };

export type QuotePricingInput = {
  flightHours: number;
  hourlyRate: number;
  repoHours: number;
  repoRate: number;
  overnightFee: number;
  landingFees: number;
  handlingFees: number;
  additionalFees: AdditionalFee[];
  fetTax: boolean;
  discount: number;
};

export function calculateQuoteTotals(input: QuotePricingInput) {
  const flightCost = input.flightHours * input.hourlyRate;
  const repoCost = input.repoHours * input.repoRate;
  const feesTotal = input.additionalFees.reduce((sum, f) => sum + (f.amount || 0), 0);
  const subtotal =
    flightCost +
    repoCost +
    input.overnightFee +
    input.landingFees +
    input.handlingFees +
    feesTotal;
  const discountedSubtotal = Math.max(subtotal - input.discount, 0);
  const fetAmount = input.fetTax ? discountedSubtotal * 0.075 : 0;
  const total = discountedSubtotal + fetAmount;

  return { flightCost, repoCost, feesTotal, subtotal, fetAmount, total };
}

// Splits a pre-tax total across legs proportionally by flight hours, so the
// client sees one fee per segment instead of the internal cost breakdown
// (hourly rate, repositioning, landing/handling fees) that produced it.
// Falls back to an even split if hours are missing/zero everywhere.
export function allocateProportionally(weights: number[], total: number): number[] {
  const sumWeights = weights.reduce((s, w) => s + w, 0);
  if (sumWeights <= 0) {
    return weights.map(() => total / (weights.length || 1));
  }
  return weights.map((w) => (w / sumWeights) * total);
}

export function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export const QUOTE_MESSAGE_BADGES: Record<string, { emoji: string; label: string }> = {
  quote_response_questions: { emoji: "💬", label: "Question" },
  quote_response_accepted: { emoji: "✅", label: "Accepted" },
  quote_response_declined: { emoji: "❌", label: "Declined" },
};

// Non-null only on internal trips created directly via /quotes/internal/new
// (owner flights, maintenance, etc.), bypassing the client quoting pipeline.
export const TRIP_PURPOSE_LABELS: Record<string, string> = {
  owner: "Owner Flight",
  maintenance: "Maintenance",
  repositioning: "Repositioning",
  other: "Internal",
};
