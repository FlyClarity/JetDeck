import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { processInboundEmail } from "@/lib/ai/process-inbound-email";

function isAuthorized(req: NextRequest) {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!secret) {
    console.warn(
      "POSTMARK_WEBHOOK_SECRET not set — accepting inbound webhook requests unauthenticated"
    );
    return true;
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;

  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
  const [, password] = decoded.split(":");
  return password === secret;
}

type PostmarkInboundPayload = {
  FromFull?: { Email?: string; Name?: string };
  From?: string;
  ToFull?: { Email?: string }[];
  To?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Date?: string;
};

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as PostmarkInboundPayload;

  const toEmail = payload.ToFull?.[0]?.Email ?? payload.To ?? "";
  const fromEmail = payload.FromFull?.Email ?? payload.From ?? "";
  const fromName = payload.FromFull?.Name || null;

  const operator = await prisma.operator.findFirst({
    where: { inboundEmail: { equals: toEmail, mode: "insensitive" } },
  });

  if (!operator) {
    console.warn(`Inbound email to unrecognized address: ${toEmail}`);
    // Still 200 — Postmark retries on non-2xx, and there's nothing to retry here.
    return new Response("No matching operator", { status: 200 });
  }

  const inboundEmail = await prisma.inboundEmail.create({
    data: {
      operatorId: operator.id,
      fromEmail,
      fromName,
      toEmail,
      subject: payload.Subject || null,
      bodyText: payload.TextBody || "",
      bodyHtml: payload.HtmlBody || null,
      receivedAt: payload.Date ? new Date(payload.Date) : new Date(),
      classification: "pending",
      status: "processing",
    },
  });

  try {
    await processInboundEmail(inboundEmail.id);
  } catch (err) {
    console.error("Failed to process inbound email", inboundEmail.id, err);
  }

  return new Response("OK", { status: 200 });
}
