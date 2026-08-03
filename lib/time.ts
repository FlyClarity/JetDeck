// Normalizes a variety of time formats the AI extraction or intake form
// might produce ("10:00", "1000", "10:00 AM", "10AM", "1000L") into a
// strict 24-hour "HH:MM" string, or null if it can't confidently parse one.
export function normalizeTimeString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[ZL]$/, "").trim();

  let m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 24 && min < 60) return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  m = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === "PM") h += 12;
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  }

  m = cleaned.match(/^(\d{1,2})\s*(AM|PM)$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[2] === "PM") h += 12;
    return `${String(h).padStart(2, "0")}:00`;
  }

  m = cleaned.match(/^(\d{3,4})$/);
  if (m) {
    const digits = m[1].padStart(4, "0");
    const h = Number(digits.slice(0, 2));
    const min = Number(digits.slice(2));
    if (h < 24 && min < 60) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }

  return null;
}

// Adds a fractional number of hours to a "HH:MM" string, wrapping at
// midnight. Returns "" if the input isn't a valid time. No timezone
// awareness — same-clock addition only; see addHoursAcrossTimezones for
// the timezone-correct version used whenever both airports' zones are known.
export function addHoursToTime(time: string, hours: number): string {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h >= 24 || min >= 60) return "";

  const totalMinutes = ((h * 60 + min + Math.round(hours * 60)) % 1440 + 1440) % 1440;
  const hh = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const mm = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

// UTC offset, in minutes, of an IANA timezone at a given instant (handles
// DST automatically since it reads the zone's actual wall clock at that
// moment rather than a fixed offset table).
function utcOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return (asUtcMs - instant.getTime()) / 60000;
}

// Adds a fractional number of hours to a local "HH:MM" departure time and
// returns the resulting *local* arrival time — converting across timezones
// when both airports' IANA zones are known, instead of naively adding hours
// as if the clock didn't change crossing zones. Falls back to plain
// same-zone addition when either zone is missing or they match. Doesn't
// signal a day rollover; the returned HH:MM can represent the next
// calendar day for long or eastbound-heavy trips.
export function addHoursAcrossTimezones(
  date: string,
  depTime: string,
  hours: number,
  depTimezone: string | null,
  arrTimezone: string | null
): string {
  if (!depTimezone || !arrTimezone || depTimezone === arrTimezone) {
    return addHoursToTime(depTime, hours);
  }
  if (!/^\d{1,2}:\d{2}$/.test(depTime)) return "";

  // Treat the wall-clock departure as if it were UTC to get a stable
  // reference instant, then correct by the departure zone's real offset at
  // that moment to find the true UTC instant of departure.
  const naiveUtcMs = Date.parse(`${date}T${depTime}:00Z`);
  if (Number.isNaN(naiveUtcMs)) return "";
  const depOffsetMin = utcOffsetMinutes(depTimezone, new Date(naiveUtcMs));
  const departureUtcMs = naiveUtcMs - depOffsetMin * 60000;

  const arrivalUtcMs = departureUtcMs + hours * 3600000;
  const arrOffsetMin = utcOffsetMinutes(arrTimezone, new Date(arrivalUtcMs));
  const arrLocalAsUtcMs = arrivalUtcMs + arrOffsetMin * 60000;

  const arrLocal = new Date(arrLocalAsUtcMs);
  const hh = arrLocal.getUTCHours().toString().padStart(2, "0");
  const mm = arrLocal.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
