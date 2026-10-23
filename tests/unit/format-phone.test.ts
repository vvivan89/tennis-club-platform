import { describe, expect, it } from 'vitest';
import { formatPhoneNumber } from '../../lib/format-phone';

describe('formatPhoneNumber', () => {
  it('formats ten digits consistently', () => {
    expect(formatPhoneNumber('6045550123')).toBe('604.555.0123');
    expect(formatPhoneNumber('(604) 555-0123')).toBe('604.555.0123');
  });

  it('accepts a leading North American country code', () => {
    expect(formatPhoneNumber('+1 604 555 0123')).toBe('604.555.0123');
  });

  it('preserves unrecognized values and handles nullish values', () => {
    expect(formatPhoneNumber('555-123')).toBe('555-123');
    expect(formatPhoneNumber(null)).toBe('');
    expect(formatPhoneNumber(undefined)).toBe('');
  });
});
