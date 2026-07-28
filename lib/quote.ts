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

export function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
