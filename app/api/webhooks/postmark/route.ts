import type { NextRequest } from "next/server";
import { after } from "next/server";
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
  MessageID?: string;
  FromFull?: { Email?: string; Name?: string };
  From?: string;
  ReplyTo?: string;
  ToFull?: { Email?: string }[];
  To?: string;
  // The actual SMTP RCPT TO address the message was delivered to — distinct
  // from the To header above whenever mail arrives via a forward (e.g. an
  // operator's real inbox auto-forwarding to their inbound.<domain>
  // address). Gmail's transparent forwarding preserves the original To
  // header rather than rewriting it, so a client's email to
  // quotes@flyclarity.com still shows "To: quotes@flyclarity.com" even
  // though it was actually routed to quotes@inbound.flyclarity.com — only
  // OriginalRecipient reflects where it truly landed, which is what
  // Operator.inboundEmail is meant to match against.
  OriginalRecipient?: string;
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
  const matchAddress = payload.OriginalRecipient || toEmail;
  const fromEmail = payload.FromFull?.Email ?? payload.From ?? "";
  const fromName = payload.FromFull?.Name || null;
  const postmarkMessageId = payload.MessageID || null;
  // Relay feeds (e.g. NBAA Air Mail) send From a shared address but set
  // Reply-To to the actual client/broker — only trust it when it's a real
  // address distinct from From, not just an artifact of the relay itself.
  const replyToRaw = payload.ReplyTo?.split(",")[0]?.trim() || null;
  const replyToEmail =
    replyToRaw && replyToRaw.toLowerCase() !== fromEmail.toLowerCase() ? replyToRaw : null;

  const operator = await prisma.operator.findFirst({
    where: { inboundEmail: { equals: matchAddress, mode: "insensitive" } },
  });

  // Unconditional, not just on failure — the last few rounds of debugging
  // this in production kept hitting "200 but nothing shows up in the app"
  // with no way to tell, from the outside, which of the early-return
  // branches below actually fired. This line should appear for every
  // single inbound webhook call, success or not.
  console.log(
    `[postmark webhook] messageId=${postmarkMessageId} toHeader=${toEmail} originalRecipient=${payload.OriginalRecipient ?? "(none)"} matchAddress=${matchAddress} operatorMatch=${operator ? operator.id : "NONE"}`
  );

  if (!operator) {
    console.warn(`Inbound email to unrecognized address: ${matchAddress}`);
    // Still 200 — Postmark retries on non-2xx, and there's nothing to retry here.
    return new Response("No matching operator", { status: 200 });
  }

  // Postmark retries a webhook delivery it considers failed (non-2xx, or
  // slow to respond) — up to 10 times, on its own backoff schedule.
  // Without this check, a retry would create a second InboundEmail row and
  // re-run the whole AI pipeline (classify + extract + score) for the same
  // message, silently multiplying the AI bill for one real email.
  if (postmarkMessageId) {
    const existing = await prisma.inboundEmail.findUnique({
      where: { postmarkMessageId },
    });
    if (existing) {
      console.log(`[postmark webhook] duplicate delivery of ${postmarkMessageId}, skipping`);
      return new Response("OK (duplicate delivery)", { status: 200 });
    }
  }

  const inboundEmail = await prisma.inboundEmail.create({
    data: {
      operatorId: operator.id,
      postmarkMessageId,
      fromEmail,
      fromName,
      replyToEmail,
      toEmail,
      subject: payload.Subject || null,
      bodyText: payload.TextBody || "",
      bodyHtml: payload.HtmlBody || null,
      receivedAt: payload.Date ? new Date(payload.Date) : new Date(),
      classification: "pending",
      status: "processing",
    },
  });

  // Respond to Postmark immediately once the email is durably stored,
  // instead of making it wait out the full classify/extract/score AI
  // pipeline — that wait is exactly what could trip Postmark's retry
  // timeout and trigger the duplicate-processing problem above in the
  // first place. after() keeps the function alive to finish this in the
  // background without blocking the response.
  after(async () => {
    try {
      await processInboundEmail(inboundEmail.id);
    } catch (err) {
      console.error("Failed to process inbound email", inboundEmail.id, err);
    }
  });

  return new Response("OK", { status: 200 });
}
