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
  unsubscribeUrl?: string;
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
  unsubscribeUrl,
  apiKey = process.env.RESEND_API_KEY,
  idempotencyKey,
}: ResendEmail) {
  if (unsubscribeUrl && new URL(unsubscribeUrl).origin !== new URL(request.url).origin)
    throw new Error('Email unsubscribe links must use the sending site origin.');
  const footerHtml = unsubscribeUrl
    ? `<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these emails</a>.</p>`
    : '';
  const htmlWithFooter = html
    ? `${html}${footerHtml}`
    : text && unsubscribeUrl
      ? `<p>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>${footerHtml}`
      : html;
  const textWithFooter =
    text && unsubscribeUrl ? `${text}\n\nUnsubscribe from these emails: ${unsubscribeUrl}` : text;

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
