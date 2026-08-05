import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return new Response("Webhook verification failed", { status: 400 });
  }

  if (evt.type === "organization.created") {
    const { id, name, slug } = evt.data;
    const operatorSlug = slug || slugify(name);

    // Just a starting point — fully editable afterward in Settings, since
    // the actual address has to match wherever Postmark's inbound stream is
    // configured for this operator's real domain.
    const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN || "inbound.jetdeck.app";

    await prisma.operator.upsert({
      where: { clerkOrgId: id },
      update: {},
      create: {
        clerkOrgId: id,
        slug: operatorSlug,
        name,
        inboundEmail: `requests-${operatorSlug}@${inboundDomain}`,
      },
    });
  }

  return new Response("OK", { status: 200 });
}
