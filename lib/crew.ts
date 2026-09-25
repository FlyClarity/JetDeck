export const CREW_ROLES = [
  { value: "captain", label: "Captain (PIC)" },
  { value: "first_officer", label: "First Officer (SIC)" },
  { value: "flight_attendant", label: "Flight Attendant" },
  { value: "other", label: "Other" },
] as const;

export function crewRoleLabel(value: string) {
  return CREW_ROLES.find((r) => r.value === value)?.label ?? value;
}

// Flight/duty rules and the Ops Review checklist's crew check only ever
// apply to pilots — a flight attendant or "other" crew member is,
// operationally, no different than a passenger for compliance purposes.
export const PILOT_ROLES = ["captain", "first_officer"];

export type QualificationStatus = "n/a" | "qualified" | "not_qualified" | "medical_expired" | "training_expired";

// "qualified" is the Chief Pilot's own manual sign-off, not derived from
// the expiry dates alone — but an expired certificate still overrides it,
// so a currency lapse can't silently pass just because nobody remembered
// to uncheck the box.
export function crewQualificationStatus(
  crew: { role: string; qualified: boolean; medicalExpiry: Date | null; trainingExpiry: Date | null },
  asOf: Date = new Date()
): QualificationStatus {
  if (!PILOT_ROLES.includes(crew.role)) return "n/a";
  if (!crew.qualified) return "not_qualified";
  if (crew.medicalExpiry && crew.medicalExpiry < asOf) return "medical_expired";
  if (crew.trainingExpiry && crew.trainingExpiry < asOf) return "training_expired";
  return "qualified";
}

export const QUALIFICATION_STATUS_LABELS: Record<QualificationStatus, string> = {
  "n/a": "—",
  qualified: "Qualified",
  not_qualified: "Not Qualified",
  medical_expired: "Medical Expired",
  training_expired: "Training Expired",
};
