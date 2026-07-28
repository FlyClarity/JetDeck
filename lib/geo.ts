const EARTH_RADIUS_NM = 3440.065;

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
