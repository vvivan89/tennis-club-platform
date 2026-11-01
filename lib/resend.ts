export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

type ResendEmail = {
  from?: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  apiKey?: string;
  /** Resend drops repeat sends with the same key for 24 hours. */
  idempotencyKey?: string;
};

export function sendResendEmail({
  from = process.env.RESEND_FROM_EMAIL,
  to,
  subject,
  html,
  text,
  apiKey = process.env.RESEND_API_KEY,
  idempotencyKey,
}: ResendEmail) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
}
