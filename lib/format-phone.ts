export function formatPhoneNumber(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length === 10)
    return `${normalized.slice(0, 3)}.${normalized.slice(3, 6)}.${normalized.slice(6)}`;
  return raw;
}
