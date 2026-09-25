import { headers } from "next/headers";

// NEXT_PUBLIC_APP_URL is baked in at build time, so it silently goes stale
// whenever the deployment domain changes (or was never set for a given
// Vercel environment) — links built from it can end up pointing at
// localhost even in production. Deriving the origin from the actual
// incoming request is self-correcting and needs no env var at all.
export async function getAppUrl(): Promise<string> {
  try {
    const hdrs = await headers();
    const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
    if (host) {
      const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() is only available inside a request context (e.g. not in a
    // cron job or script) — fall through to the env var / default below.
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
