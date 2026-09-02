import { revenueLegsOf, legDate, legTimeLabel, routeAndDateText } from "@/lib/itinerary";

// The three core booking-lifecycle emails an operator can customize —
// wording and subject only, not the structural bits that depend on real
// state (payment method, wire instructions, terms) — those stay app-
// controlled and get appended after the templated body, same as before
// this existed. See app/(app)/settings/page.tsx for the editor and
// callers below for how each renders.

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

// {{routeShort}} (subject-safe, one line) and {{routing}} (body-safe, one
// line per leg) — the same full leg-by-leg breakdown the Quote Builder's
// conflict banner and booking confirmation email already build, rather than
// the collapsed first-dep → last-arr summary that hides what a multi-leg
// trip is actually doing.
export function routingVars(itinerary: unknown): { routeShort: string; routing: string; date: string } {
  const { route, date } = routeAndDateText(itinerary);
  const routing = revenueLegsOf(itinerary)
    .map((leg) => `${leg.depAirport} → ${leg.arrAirport} — ${legDate(leg)}, ${legTimeLabel(leg)}`)
    .join("<br/>");
  return { routeShort: route, routing: routing || route, date };
}

type TemplateVariable = { key: string; description: string };

type TemplateDef = {
  label: string;
  description: string;
  defaultSubject: string;
  defaultBody: string;
  variables: TemplateVariable[];
};

const CLIENT_NAME_VAR = { key: "clientName", description: "The client's name" };
const OPERATOR_NAME_VAR = { key: "operatorName", description: "Your operator name" };
const QUOTE_NUMBER_VAR = { key: "quoteNumber", description: "e.g. Q-2026-0042" };
const ROUTE_SHORT_VAR = {
  key: "routeShort",
  description: "Collapsed route for a subject line, e.g. KCVO → KBPG",
};
const ROUTING_VAR = {
  key: "routing",
  description: "Full leg-by-leg breakdown (route, date, time) — use in the body, not the subject",
};

export const EMAIL_TEMPLATES = {
  quote_sent: {
    label: "Quote Sent",
    description: "Sent when you send a draft quote to the client.",
    defaultSubject: "Your Charter Quote — {{routeShort}} ({{quoteNumber}})",
    defaultBody: `<p>Hi {{clientName}},</p><p>Your quote is ready: <a href="{{quoteLink}}">View Quote</a></p><p><strong>Routing:</strong><br/>{{routing}}</p><p>{{pricingLine}} Valid until {{validUntil}}.</p><p>— {{operatorName}}</p>`,
    variables: [
      CLIENT_NAME_VAR,
      QUOTE_NUMBER_VAR,
      ROUTE_SHORT_VAR,
      ROUTING_VAR,
      { key: "pricingLine", description: "e.g. \"Total: $58,372.50.\", or option count if there's more than one" },
      { key: "validUntil", description: "Quote expiration date" },
      { key: "quoteLink", description: "The client-facing quote link" },
      OPERATOR_NAME_VAR,
    ],
  },
  booking_confirmed: {
    label: "Booking Confirmed",
    description:
      "Sent once the client signs and their card hold/payment goes through. Wire instructions, the card-authorization follow-up line, and your charter terms are appended automatically after this — they aren't part of the editable text.",
    defaultSubject: "Your Charter Agreement — {{routeShort}} on {{date}}",
    defaultBody: `<p>Hi {{clientName}},</p><p>Thank you for booking with {{operatorName}}. Your charter agreement is confirmed.</p><p><strong>Reference:</strong> {{quoteNumber}}</p><p><strong>Routing:</strong><br/>{{routing}}</p><p><strong>Total:</strong> {{total}}{{paymentLine}}</p>`,
    variables: [
      CLIENT_NAME_VAR,
      OPERATOR_NAME_VAR,
      QUOTE_NUMBER_VAR,
      ROUTE_SHORT_VAR,
      { key: "date", description: "First leg's departure date" },
      ROUTING_VAR,
      { key: "total", description: "Total price" },
      {
        key: "paymentLine",
        description: "App-generated payment summary (method, amount) — already formatted HTML, drop it in as-is",
      },
    ],
  },
  booking_cancelled: {
    label: "Booking Cancelled",
    description: "Sent when you cancel an already-confirmed booking.",
    defaultSubject: "Booking Cancelled — {{routeShort}} ({{quoteNumber}})",
    defaultBody: `<p>Hi {{clientName}},</p><p>We're sorry to let you know your booking ({{quoteNumber}}) has been cancelled: {{cancellationNote}}</p><p>Please contact us so we can help find another solution.</p><p>— {{operatorName}}</p>`,
    variables: [
      CLIENT_NAME_VAR,
      QUOTE_NUMBER_VAR,
      ROUTE_SHORT_VAR,
      { key: "cancellationNote", description: "The reason you entered when cancelling" },
      OPERATOR_NAME_VAR,
    ],
  },
} satisfies Record<string, TemplateDef>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
