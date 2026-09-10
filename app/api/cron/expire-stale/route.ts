import type { NextRequest } from "next/server";
import { expireStaleRequestsAndQuotes } from "@/lib/expire-stale";

// Vercel Cron calls this with an `Authorization: Bearer ${CRON_SECRET}`
// header automatically once CRON_SECRET is set as an env var and this route
// is registered in vercel.json — checked here so the endpoint can't be
// triggered by anyone who finds the URL. If CRON_SECRET isn't set yet,
// requests are rejected rather than silently allowed through.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await expireStaleRequestsAndQuotes();
  // Unconditional, not just on failure — same reasoning as the Postmark
  // webhook's own always-log line: this is the only way to tell, from
  // outside, whether the cron actually ran and what it found.
  console.log(`[cron expire-stale] tripRequestsExpired=${result.tripRequestsExpired} quotesExpired=${result.quotesExpired}`);
  return Response.json(result);
}
