import { Resend } from "resend";

// Constructed defensively, not just gated on presence — same reasoning as
// lib/ai/anthropic-client.ts. A malformed RESEND_API_KEY throws inside the
// SDK's own header setup at construction time, which for module-scope code
// means at import time, taking down every route that imports this (which is
// most of the app) during Next.js's build-time page-data collection.
function buildClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  try {
    return new Resend(process.env.RESEND_API_KEY);
  } catch (err) {
    console.error("Failed to construct Resend client — check RESEND_API_KEY", err);
    return null;
  }
}

const resend = buildClient();

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  from?: string | null;
  fromName?: string | null;
}) {
  if (!resend) {
    console.warn(
      `RESEND_API_KEY not set — skipping email to ${params.to}: "${params.subject}"`
    );
    return;
  }

  const fromAddress = params.from || process.env.EMAIL_FROM || "noreply@jetdeck.app";

  await resend.emails.send({
    // A display name means most inboxes show "Clarity Aviation" rather than
    // the raw technical sending address — the client's actual reply
    // destination is controlled by replyTo below, not this.
    from: params.fromName ? `${params.fromName} <${fromAddress}>` : fromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
  });
}
