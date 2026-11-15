import { describe, expect, it } from 'vitest';
import { doublesCategoryForGender, isStrictMixedDoublesPair } from '@/lib/league-gender';

describe('Mixed doubles League and Ladder rules', () => {
  it.each([
    ['male', 'men'],
    ['female', 'women'],
    ['mixed', 'mixed'],
  ])('maps %s to the %s category', (gender, category) => {
    expect(doublesCategoryForGender(gender)).toBe(category);
  });

  it('accepts only a male and female pair in either order', () => {
    expect(isStrictMixedDoublesPair('male', 'female')).toBe(true);
    expect(isStrictMixedDoublesPair('female', 'male')).toBe(true);
    expect(isStrictMixedDoublesPair('male', 'male')).toBe(false);
    expect(isStrictMixedDoublesPair('female', 'female')).toBe(false);
    expect(isStrictMixedDoublesPair('male', null)).toBe(false);
    expect(isStrictMixedDoublesPair('other', 'female')).toBe(false);
  });
});
