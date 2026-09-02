import tzLookup from "tz-lookup";

const EARTH_RADIUS_NM = 3440.065;

// Airport.timezone has never actually been backfilled (the OurAirports
// import didn't include it) — every row's stored value is null. Anywhere
// that needs a real IANA zone for time math has to fall back to computing
// it from lat/lon instead of trusting the column, or it silently gets
// "same zone" behavior for every cross-country route. Kept auth-free (no
// "use server"/tenant context) so it's usable from public client-facing
// pages, not just authenticated ops code.
export function resolveAirportTimezone(
  stored: string | null | undefined,
  lat: number,
  lon: number
): string | null {
  if (stored) return stored;
  try {
    return tzLookup(lat, lon);
  } catch {
    return null;
  }
}

export function greatCircleDistanceNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.asin(Math.sqrt(a));
}

// Estimated block time: raw cruise-speed flight time plus a fixed buffer for
// climb/descent/taxi (operator-configurable, see Operator.defaultBlockTimeBufferHours).
export function estimateFlightHours(
  distanceNm: number,
  cruiseSpeedKts: number,
  blockTimeBufferHours: number
) {
  if (!cruiseSpeedKts || cruiseSpeedKts <= 0) return null;
  return distanceNm / cruiseSpeedKts + blockTimeBufferHours;
}

// Whole calendar days between two YYYY-MM-DD date strings, floored at 0.
export function nightsBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  return Math.max(diffDays, 0);
}
