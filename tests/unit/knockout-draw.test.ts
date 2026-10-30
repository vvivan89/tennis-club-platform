import { describe, expect, it } from 'vitest';
import { pairKnockoutFirstRound, type KnockoutDrawSlot } from '@/lib/knockout-draw';

function slots(groupCount: number, promoted: number): KnockoutDrawSlot[] {
  return Array.from({ length: promoted }, (_, rank) =>
    Array.from({ length: groupCount }, (_unused, group) => ({
      id: `g${group + 1}r${rank + 1}`,
      label: `Group ${group + 1} Team ${rank + 1}`,
      group: group + 1,
      rank: rank + 1,
    })),
  ).flat();
}

const stableRandom = () => 0.37;

describe('pairKnockoutFirstRound', () => {
  it('creates A1-B2 and B1-A2 when two groups promote two teams each', () => {
    const result = pairKnockoutFirstRound({
      slots: slots(2, 2),
      roundRobinEnabled: true,
      promotedPerGroup: 2,
      random: stableRandom,
    });
    expect(result).toHaveLength(2);
    expect(
      result.every(([one, two]) => one.group !== two.group && one.rank! + two.rank! === 3),
    ).toBe(true);
    expect(result.map(([one, two]) => [one.rank, two.rank].sort().join('-')).sort()).toEqual([
      '1-2',
      '1-2',
    ]);
  });

  it('pairs first place against last promoted place and avoids same-group pairings', () => {
    const result = pairKnockoutFirstRound({
      slots: slots(4, 2),
      roundRobinEnabled: true,
      promotedPerGroup: 2,
      random: stableRandom,
    });
    expect(result).toHaveLength(4);
    for (const [one, two] of result) {
      expect(one.group).not.toBe(two.group);
      expect(one.rank! + two.rank!).toBe(3);
    }
  });

  it('pairs outer ranks for four promoted teams', () => {
    const result = pairKnockoutFirstRound({
      slots: slots(4, 4),
      roundRobinEnabled: true,
      promotedPerGroup: 4,
      random: stableRandom,
    });
    for (const [one, two] of result) {
      expect(one.group).not.toBe(two.group);
      expect(one.rank! + two.rank!).toBe(5);
    }
  });

  it('allows the only team from each group to play another group winner', () => {
    const result = pairKnockoutFirstRound({
      slots: slots(4, 1),
      roundRobinEnabled: true,
      promotedPerGroup: 1,
      random: stableRandom,
    });
    expect(result).toHaveLength(2);
    expect(result.every(([one, two]) => one.group !== two.group)).toBe(true);
  });

  it('avoids bye-versus-bye matches when real entrants can receive the byes instead', () => {
    const entries = slots(3, 2);
    entries.push(
      { id: null, label: 'Bye', group: null, rank: null },
      { id: null, label: 'Bye', group: null, rank: null },
    );
    const result = pairKnockoutFirstRound({
      slots: entries,
      roundRobinEnabled: true,
      promotedPerGroup: 2,
      random: stableRandom,
    });
    expect(result.every(([one, two]) => one.label !== 'Bye' || two.label !== 'Bye')).toBe(true);
  });

  it('does not apply group/rank constraints when there is no round robin phase', () => {
    const result = pairKnockoutFirstRound({
      slots: slots(2, 2),
      roundRobinEnabled: false,
      promotedPerGroup: 2,
      random: stableRandom,
    });
    expect(
      result
        .flat()
        .map((slot) => slot.id)
        .sort(),
    ).toEqual(
      slots(2, 2)
        .map((slot) => slot.id)
        .sort(),
    );
  });
});
