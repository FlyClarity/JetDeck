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

  if (evt.type === "organization.created" || evt.type === "organization.updated") {
    const { id, name, slug, image_url, has_image } = evt.data;
    const operatorSlug = slug || slugify(name);
    // Clerk's org profile (name + logo) is the source of truth — JetDeck
    // shouldn't ask an operator to maintain the same identity twice, so
    // both fields sync here on every create/update instead of being
    // editable in Settings.
    const logoUrl = has_image ? image_url : null;

    // Just a starting point — fully editable afterward in Settings, since
    // the actual address has to match wherever Postmark's inbound stream is
    // configured for this operator's real domain.
    const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN || "inbound.jetdeck.app";

    await prisma.operator.upsert({
      where: { clerkOrgId: id },
      update: { name, logoUrl },
      create: {
        clerkOrgId: id,
        slug: operatorSlug,
        name,
        logoUrl,
        inboundEmail: `requests-${operatorSlug}@${inboundDomain}`,
      },
    });
  }

  return new Response("OK", { status: 200 });
}
