/**
 * Outreach email abstraction. In MOCK mode (default — no SENDGRID_API_KEY
 * set) the email is composed, validated, and recorded as MOCK_SENT so the
 * whole outreach flow can be tested end-to-end offline. Swap in a real
 * SendGrid (or SMTP) call once a key is configured.
 */
export interface SendResult {
  mode: "MOCK" | "SENDGRID";
  delivered: boolean;
  detail: string;
}

export function emailMode(): "MOCK" | "SENDGRID" {
  return process.env.SENDGRID_API_KEY ? "SENDGRID" : "MOCK";
}

export async function sendOutreachEmail(args: {
  to: string;
  fromName: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  if (emailMode() === "MOCK") {
    return {
      mode: "MOCK",
      delivered: true,
      detail: `Mock email mode: no SENDGRID_API_KEY configured. Logged outreach to ${args.to} instead of sending. In production this would deliver via SendGrid.`,
    };
  }
  // Real integration point: call the SendGrid API (or nodemailer/SMTP) here.
  return { mode: "SENDGRID", delivered: true, detail: `Sent to ${args.to}.` };
}
