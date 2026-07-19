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

    await prisma.operator.upsert({
      where: { clerkOrgId: id },
      update: {},
      create: {
        clerkOrgId: id,
        slug: operatorSlug,
        name,
        inboundEmail: `requests-${operatorSlug}@inbound.jetdeck.app`,
      },
    });
  }

  return new Response("OK", { status: 200 });
}
