import { calculateQuoteTotals, type AdditionalFee } from "@/lib/quote";

// Parses one "Options" tab's worth of pricing/itinerary fields out of the
// Quote Builder's submitted FormData — every field the client-side form for
// a single option emits (see QuoteOptionFields in
// components/quote/quote-builder-form.tsx) is namespaced with the same
// prefix (e.g. "option_0_") so N options can share one <form> submission.
// Shared by both createQuote (quotes/new) and updateQuote (quotes/[id]),
// which used to each inline this parsing for a single implicit option.
export function parseOptionFromFormData(
  formData: FormData,
  prefix: string,
  defaultOvernightFee: number
) {
  const fleetSource = String(formData.get(`${prefix}fleetSource`) ?? "own_fleet");
  const isBrokered = fleetSource === "brokered";
  const aircraftId = isBrokered ? "" : String(formData.get(`${prefix}aircraftId`) ?? "");
  const brokeredAircraftId = isBrokered
    ? String(formData.get(`${prefix}brokeredAircraftId`) ?? "") || null
    : null;
  const flightHours = Number(formData.get(`${prefix}flightHours`) ?? 0);
  const hourlyRate = Number(formData.get(`${prefix}hourlyRate`) ?? 0);
  const repoHours = Number(formData.get(`${prefix}repoHours`) ?? 0);
  const repoRate = Number(formData.get(`${prefix}repoRate`) ?? 0);
  const wholesaleCost = isBrokered && formData.get(`${prefix}wholesaleCost`)
    ? Number(formData.get(`${prefix}wholesaleCost`))
    : null;
  // The client already computes the right number of nights for whichever
  // mode the "returns to base between legs" toggle is in (0 when it's on,
  // since gaps become repositioning legs instead of overnight stays) — no
  // need to re-derive or override it here.
  const returnsToHomeBase = formData.get(`${prefix}returnsToHomeBase`) === "on";
  const overnightNights = Number(formData.get(`${prefix}overnightNights`) ?? 0);
  const overnightFee = overnightNights * defaultOvernightFee;
  const landingFees = Number(formData.get(`${prefix}landingFees`) ?? 0);
  const handlingFees = Number(formData.get(`${prefix}handlingFees`) ?? 0);
  const fetTaxEnabled = formData.get(`${prefix}fetTax`) === "on";
  const discount = Number(formData.get(`${prefix}discount`) ?? 0);
  const discountNote = String(formData.get(`${prefix}discountNote`) ?? "") || null;
  const label = String(formData.get(`${prefix}label`) ?? "") || null;
  const clientNotes = String(formData.get(`${prefix}clientNotes`) ?? "") || null;

  let additionalFees: AdditionalFee[] = [];
  try {
    additionalFees = JSON.parse(String(formData.get(`${prefix}additionalFeesJson`) ?? "[]"));
  } catch {
    additionalFees = [];
  }

  const { subtotal, total, fetAmount } = calculateQuoteTotals({
    flightHours,
    hourlyRate,
    repoHours,
    repoRate,
    overnightFee,
    landingFees,
    handlingFees,
    additionalFees,
    fetTax: fetTaxEnabled,
    discount,
    flatRate: isBrokered,
  });
  // Reported to the operator only — never shown to the client. Deliberately
  // hourlyRate (the flat flight price the client's charged) minus
  // wholesaleCost, not `total` minus wholesaleCost — `total` includes FET,
  // which is collected on the client's behalf and remitted, not money the
  // operator keeps, so it must never inflate the margin figure.
  const brokerMargin = isBrokered && wholesaleCost !== null ? hourlyRate - wholesaleCost : null;

  let legsJson: unknown[] = [];
  try {
    legsJson = JSON.parse(String(formData.get(`${prefix}legsJson`) ?? "[]"));
  } catch {
    legsJson = [];
  }
  const itinerary = (legsJson as Record<string, unknown>[]).map((leg) => ({
    billAs: String(leg.billAs ?? "revenue"),
    depAirport: leg.depAirport ? String(leg.depAirport) : null,
    arrAirport: leg.arrAirport ? String(leg.arrAirport) : null,
    date: leg.date ? String(leg.date) : null,
    flightHours: Number(leg.flightHours) || 0,
    depTime: leg.depTime ? String(leg.depTime) : null,
    depTimeTBD: Boolean(leg.depTimeTBD),
    arrTime: leg.arrTime ? String(leg.arrTime) : null,
  }));

  return {
    label,
    clientNotes,
    aircraftId: aircraftId || null,
    fleetSource,
    brokeredAircraftId,
    wholesaleCost,
    brokerMargin,
    itinerary,
    flightHours,
    hourlyRate,
    repoHours,
    repoRate,
    returnsToHomeBase,
    overnightNights,
    overnightFee,
    landingFees,
    handlingFees,
    additionalFees,
    fetTax: fetAmount,
    discount,
    discountNote,
    subtotal,
    total,
  };
}

// How many options the submission carries — the outer form emits this
// alongside option_0_*, option_1_*, ... so the server doesn't have to guess.
export function parseOptionCount(formData: FormData): number {
  const raw = Number(formData.get("optionCount") ?? 1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}
