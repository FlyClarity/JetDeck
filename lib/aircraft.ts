export const AIRCRAFT_CATEGORIES = [
  { value: "light", label: "Light" },
  { value: "midsize", label: "Midsize" },
  { value: "super_midsize", label: "Super-Midsize" },
  { value: "heavy", label: "Heavy" },
  { value: "ultra_long", label: "Ultra Long" },
] as const;

export const AIRCRAFT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export function categoryLabel(value: string) {
  return AIRCRAFT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
