import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

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
