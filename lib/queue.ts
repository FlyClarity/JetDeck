export function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const SOURCE_BADGES: Record<string, { emoji: string; label: string }> = {
  email_inbound: { emoji: "📧", label: "Email" },
  intake_form: { emoji: "📋", label: "Form" },
  manual: { emoji: "✏️", label: "Manual" },
};

export const SCORE_BADGES: Record<string, { emoji: string; label: string }> = {
  high: { emoji: "🟢", label: "HIGH" },
  medium: { emoji: "🟡", label: "MEDIUM" },
  low: { emoji: "⚪", label: "LOW" },
  pass: { emoji: "🔴", label: "PASS" },
};

export function routeSummary(
  legs: unknown,
  tripType: string
): string {
  const legArray = Array.isArray(legs) ? (legs as Record<string, unknown>[]) : [];
  const firstLeg = legArray[0];
  if (!firstLeg) return "Route unknown";

  const dep = String(firstLeg.depAirport ?? "?");
  const arr = String(firstLeg.arrAirport ?? "?");
  const date = firstLeg.date ? formatShortDate(String(firstLeg.date)) : "";

  const base = `${dep} → ${arr}`;
  const suffix = date ? `, ${date}` : "";

  if (tripType === "multi_leg" && legArray.length > 1) {
    return `${base} +${legArray.length - 1} more${suffix}`;
  }

  return `${base}${suffix}`;
}

function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function paxCount(legs: unknown): number | null {
  const legArray = Array.isArray(legs) ? (legs as Record<string, unknown>[]) : [];
  const firstLeg = legArray[0];
  const count = firstLeg?.passengerCount;
  return typeof count === "number" ? count : null;
}
