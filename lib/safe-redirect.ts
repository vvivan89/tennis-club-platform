/** Returns `value` only when it is a same-origin relative path; otherwise `fallback`. */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  // Browsers treat backslashes like slashes, so `/\evil.com` would become `//evil.com`.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, 'https://redirect.invalid');
    if (parsed.origin !== 'https://redirect.invalid') return fallback;
  } catch {
    return fallback;
  }
  return value;
}
