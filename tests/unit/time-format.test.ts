import { describe, expect, it } from 'vitest';
import { formatClockTime, formatTime } from '@/lib/time-format';

describe('time formatting', () => {
  it('formats registration times with dotted lowercase meridiem', () => {
    expect(formatClockTime('18:00')).toBe('6:00 p.m.');
    expect(formatClockTime('06:05')).toBe('6:05 a.m.');
    expect(formatClockTime('12:00')).toBe('12:00 p.m.');
    expect(formatClockTime('00:00')).toBe('12:00 a.m.');
  });

  it('formats dates using the same time convention', () => {
    expect(formatTime(new Date('2026-01-01T18:00:00'))).toMatch(/6:00 p\.m\./);
  });

  it('returns an empty string for invalid values', () => {
    expect(formatClockTime('bad')).toBe('');
    expect(formatTime('bad')).toBe('');
  });
});
