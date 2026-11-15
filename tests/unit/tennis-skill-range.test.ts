import { describe, expect, it } from 'vitest';
import {
  formatTennisSkillRange,
  getTennisSkillRestrictionError,
  isTennisSkillInRange,
  tennisSkillInputValue,
} from '@/lib/tennis-skill-range';

describe('tennis skill restrictions', () => {
  it('formats open and bounded ranges', () => {
    expect(formatTennisSkillRange({ minimum: null, maximum: null })).toBeNull();
    expect(formatTennisSkillRange({ minimum: 3, maximum: 4.5 })).toBe('3.0–4.5');
    expect(formatTennisSkillRange({ minimum: 3, maximum: null })).toBe('3.0 and above');
    expect(formatTennisSkillRange({ minimum: null, maximum: 4 })).toBe('up to 4.0');
  });

  it('normalizes persisted numeric values to selector option strings', () => {
    expect(tennisSkillInputValue(4)).toBe('4.0');
    expect(tennisSkillInputValue(null)).toBe('');
  });

  it('accepts inclusive in-range ratings and leaves unrestricted events open', () => {
    expect(isTennisSkillInRange(3, { minimum: 3, maximum: 4 })).toBe(true);
    expect(isTennisSkillInRange('4.5', { minimum: 3, maximum: 4 })).toBe(false);
    expect(isTennisSkillInRange(null, { minimum: null, maximum: null })).toBe(true);
  });

  it('returns a useful reason when a required rating is missing or outside the range', () => {
    const range = { minimum: 3, maximum: 4 };
    expect(getTennisSkillRestrictionError(null, range)).toContain('rating is required');
    expect(getTennisSkillRestrictionError('2.5', range)).toContain('3.0–4.0');
    expect(getTennisSkillRestrictionError('3.5', range)).toBeNull();
  });
});
