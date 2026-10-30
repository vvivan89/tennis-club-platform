import { describe, expect, it } from 'vitest';
import {
  isGenderEligibleForCategory,
  knockoutStageLabel,
  knockoutRoundCount,
  matchHasResult,
  reorderRankingPriority,
} from '@/lib/tournament-config';

describe('reorderRankingPriority', () => {
  it('moves a criterion to an earlier position', () => {
    expect(reorderRankingPriority(['a', 'b', 'c', 'd'], 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moves a criterion to a later position', () => {
    expect(reorderRankingPriority(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('leaves priorities unchanged when the source is unknown', () => {
    expect(reorderRankingPriority(['a', 'b'], 'missing', 0)).toEqual(['a', 'b']);
  });
});

describe('knockoutStageLabel', () => {
  it('infers final, semifinal, and quarterfinal rounds from bracket depth', () => {
    expect(knockoutStageLabel(1, 3)).toBe('Quarterfinal');
    expect(knockoutStageLabel(1, 4)).toBe('Round of 16');
    expect(knockoutStageLabel(1, 5)).toBe('Round of 32');
    expect(knockoutStageLabel(2, 3)).toBe('Semifinal');
    expect(knockoutStageLabel(3, 3)).toBe('Final');
  });

  it('labels a two-round bracket as semifinals followed by a final', () => {
    expect(knockoutStageLabel(1, 2)).toBe('Semifinal');
    expect(knockoutStageLabel(2, 2)).toBe('Final');
  });
});

describe('isGenderEligibleForCategory', () => {
  it('leaves all categories available when gender is unspecified', () => {
    expect(isGenderEligibleForCategory('men', null)).toBe(true);
    expect(isGenderEligibleForCategory('women', undefined)).toBe(true);
    expect(isGenderEligibleForCategory('mixed', null)).toBe(true);
  });

  it('matches known gender to the category and rejects other known values', () => {
    expect(isGenderEligibleForCategory('men', 'male')).toBe(true);
    expect(isGenderEligibleForCategory('women', 'male')).toBe(false);
    expect(isGenderEligibleForCategory('mixed', 'female')).toBe(true);
    expect(isGenderEligibleForCategory('mixed', 'other')).toBe(true);
  });
});

describe('knockout bracket helpers', () => {
  it('rounds entrant counts up to the next power-of-two bracket depth', () => {
    expect(knockoutRoundCount(2)).toBe(1);
    expect(knockoutRoundCount(4)).toBe(2);
    expect(knockoutRoundCount(9)).toBe(4);
    expect(knockoutRoundCount(31)).toBe(5);
    expect(knockoutRoundCount(0)).toBe(0);
  });

  it('recognizes completed, scored, and winner-assigned matches as having results', () => {
    expect(matchHasResult({ status: 'completed' })).toBe(true);
    expect(matchHasResult({ winner_side: 1 })).toBe(true);
    expect(matchHasResult({ score_sets: [{ one: 6, two: 4 }] })).toBe(true);
    expect(matchHasResult({ status: 'scheduled', winner_side: null, score_sets: [] })).toBe(false);
  });
});
