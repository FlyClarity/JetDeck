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

export const AIRCRAFT_AMENITIES = [
  { value: "wifi", label: "Wi-Fi" },
  { value: "galley", label: "Galley / catering prep" },
  { value: "lavatory", label: "Enclosed lavatory" },
  { value: "flat_screen", label: "Flat-screen displays" },
  { value: "leather_seats", label: "Leather seating" },
  { value: "berthing", label: "Berthing / sleeping seats" },
  { value: "pet_friendly", label: "Pet friendly" },
  { value: "wheelchair_accessible", label: "Wheelchair accessible" },
] as const;

export function categoryLabel(value: string) {
  return AIRCRAFT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function amenityLabel(value: string) {
  return AIRCRAFT_AMENITIES.find((a) => a.value === value)?.label ?? value;
}
