export const CREW_ROLES = [
  { value: "captain", label: "Captain (PIC)" },
  { value: "first_officer", label: "First Officer (SIC)" },
  { value: "flight_attendant", label: "Flight Attendant" },
  { value: "other", label: "Other" },
] as const;

export function crewRoleLabel(value: string) {
  return CREW_ROLES.find((r) => r.value === value)?.label ?? value;
}
