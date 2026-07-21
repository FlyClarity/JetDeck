import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}) {
  if (!resend) {
    console.warn(
      `RESEND_API_KEY not set — skipping email to ${params.to}: "${params.subject}"`
    );
    return;
  }

  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "noreply@jetdeck.app",
    to: params.to,
    subject: params.subject,
    html: params.html,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
  });
}
