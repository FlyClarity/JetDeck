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

// A crude tag-stripper, not a real HTML parser — every email body built in
// this app is simple, hand-written markup (p/a/br/strong), so this is
// enough to get a readable plain-text alternative without pulling in a
// dependency. Sending HTML-only email is itself a spam-score signal most
// providers penalize, so every send gets one of these unless the caller
// supplies its own.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Surfaces whether the domain an operator's "From" address actually sends
// from is verified in Resend — the single most common cause of a quote
// email never reaching the client (or landing in spam): an unverified
// domain fails SPF/DKIM, which every major inbox provider treats as a
// strong spam/spoofing signal. Used by the Settings page so this is
// something ops can see and fix themselves, not something only visible by
// digging into the Resend dashboard directly.
export async function checkDomainStatus(
  email: string
): Promise<
  | { domain: string; found: false }
  | { domain: string; found: true; status: string; sendingEnabled: boolean }
  | null
> {
  if (!resend) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  const { data, error } = await resend.domains.list();
  if (error || !data) return null;

  const match = data.data.find((d) => d.name.toLowerCase() === domain);
  if (!match) return { domain, found: false };
  return {
    domain,
    found: true,
    status: match.status,
    sendingEnabled: match.capabilities.sending === "enabled",
  };
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  // Silent copy to the operator on a client-facing send, so they have proof
  // in their own inbox that it actually went out — without this, the only
  // record was whatever Resend's own dashboard showed, which an operator
  // wouldn't think to check when a client says "I never got it." Callers
  // pass this explicitly per send (not inferred from replyTo) since some
  // "client-facing" sends set replyTo to the *client's* address instead
  // (an internal notification the operator can reply straight to them
  // from) — bcc-ing that back to the client would be wrong.
  bcc?: string;
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
    text: htmlToText(params.html),
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    ...(params.bcc ? { bcc: params.bcc } : {}),
  });
}
