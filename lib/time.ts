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
// midnight. Returns "" if the input isn't a valid time.
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
