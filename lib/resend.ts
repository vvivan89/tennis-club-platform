export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

type ResendEmail = {
  /** Request whose host should be used for links in this email. */
  request: Pick<Request, 'url'>;
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
  request,
  to,
  subject,
  html,
  text,
  apiKey = process.env.RESEND_API_KEY,
  idempotencyKey,
}: ResendEmail) {
  const profileUrl = new URL('/member/profile', new URL(request.url).origin).toString();
  const footerHtml = `<p>To unsubscribe from these emails, visit your club member <a href="${escapeHtml(profileUrl)}">profile</a>.</p>`;
  const htmlWithFooter = html
    ? `${html}${footerHtml}`
    : text
      ? `<p>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>${footerHtml}`
      : undefined;
  const textWithFooter = text
    ? `${text}\n\nTo unsubscribe from these emails, visit your club member profile: ${profileUrl}`
    : text;

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [to], subject, html: htmlWithFooter, text: textWithFooter }),
  });
}
