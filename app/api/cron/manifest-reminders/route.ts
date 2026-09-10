import type { NextRequest } from "next/server";
import { sendManifestReminders } from "@/lib/manifest";

// Same CRON_SECRET auth pattern as /api/cron/expire-stale.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await sendManifestReminders();
  return Response.json(result);
}
