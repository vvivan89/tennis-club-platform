/** Public origin for links in emails and redirects; NEXT_PUBLIC_SITE_URL wins over the request host. */
export function getSiteOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.error('NEXT_PUBLIC_SITE_URL is not a valid URL; falling back to the request host.');
    }
  }
  return new URL(request.url).origin;
}
