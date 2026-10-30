import { describe, expect, it } from 'vitest';
import { buildKnockoutSchedule, phaseStartAfterPrerequisites } from '@/lib/tournament-schedule';

describe('phaseStartAfterPrerequisites', () => {
  const baseStart = '2026-10-27T09:00:00.000Z';

  it('starts a round-robin phase at least one hour after the latest preliminary match ends', () => {
    const start = phaseStartAfterPrerequisites({
      baseStart,
      matchMinutes: 60,
      prerequisiteMatches: [
        { scheduled_at: '2026-10-27T10:00:00.000Z', status: 'scheduled' },
        { scheduled_at: '2026-10-27T13:30:00.000Z', status: 'scheduled' },
      ],
    });
    expect(start.toISOString()).toBe('2026-10-27T15:30:00.000Z');
  });

  it('starts knockout at 3:30 p.m. when the last round-robin match starts at 1:30 p.m. and lasts one hour', () => {
    const start = phaseStartAfterPrerequisites({
      baseStart: '2026-10-24T11:00:00.000Z',
      matchMinutes: 60,
      minimumBreakMinutes: 60,
      prerequisiteMatches: [
        { scheduled_at: '2026-10-24T11:00:00.000Z', status: 'scheduled' },
        { scheduled_at: '2026-10-24T13:30:00.000Z', status: 'scheduled' },
      ],
    });
    expect(start.toISOString()).toBe('2026-10-24T15:30:00.000Z');
  });

  it('starts knockout after the latest round-robin match ends with a one-hour stage break', () => {
    const start = phaseStartAfterPrerequisites({
      baseStart,
      matchMinutes: 75,
      minimumBreakMinutes: 15,
      prerequisiteMatches: [
        { scheduled_at: '2026-10-27T12:00:00.000Z', status: 'completed' },
        { scheduled_at: '2026-10-27T14:00:00.000Z', status: 'scheduled' },
      ],
    });
    expect(start.toISOString()).toBe('2026-10-27T16:15:00.000Z');
  });

  it('does not move the event start later when there are no prerequisite matches', () => {
    expect(
      phaseStartAfterPrerequisites({
        baseStart,
        matchMinutes: 60,
        prerequisiteMatches: [],
      }).toISOString(),
    ).toBe(baseStart);
  });

  it('requires unfinished prerequisite matches to be scheduled first', () => {
    expect(() =>
      phaseStartAfterPrerequisites({
        baseStart,
        matchMinutes: 60,
        prerequisiteMatches: [{ scheduled_at: null, status: 'scheduled' }],
      }),
    ).toThrow('Schedule the preceding tournament phase before suggesting this phase schedule.');
  });
});

describe('buildKnockoutSchedule', () => {
  const base = new Date(2026, 9, 24, 8).toISOString();
  const end = new Date(2026, 9, 24, 16).toISOString();

  it('schedules matches in the same knockout round simultaneously on different courts', () => {
    const assignments = buildKnockoutSchedule({
      matches: [
        { id: 'a', round_number: 1, match_number: 1, status: 'scheduled' },
        { id: 'b', round_number: 1, match_number: 2, status: 'scheduled' },
      ],
      baseStart: base,
      eventEnd: end,
      matchMinutes: 60,
      betweenMatchBreakMinutes: 15,
      courtCount: 2,
    });
    expect(assignments.map((item) => item.scheduled_at)).toEqual([base, base]);
    expect(assignments.map((item) => item.court_number)).toEqual([1, 2]);
  });

  it('schedules overflow matches in later waves only when matches exceed available courts', () => {
    const assignments = buildKnockoutSchedule({
      matches: [1, 2, 3].map((match_number) => ({
        id: String(match_number),
        round_number: 1,
        match_number,
        status: 'scheduled',
      })),
      baseStart: base,
      eventEnd: end,
      matchMinutes: 60,
      betweenMatchBreakMinutes: 15,
      courtCount: 2,
    });
    expect(assignments[0].scheduled_at).toBe(base);
    expect(assignments[1].scheduled_at).toBe(base);
    expect(assignments[2].scheduled_at).toBe(new Date(2026, 9, 24, 9, 15).toISOString());
  });

  it('starts the next knockout round one hour after the previous round finishes', () => {
    const assignments = buildKnockoutSchedule({
      matches: [
        { id: 'a', round_number: 1, match_number: 1, status: 'scheduled' },
        { id: 'b', round_number: 1, match_number: 2, status: 'scheduled' },
        { id: 'c', round_number: 2, match_number: 1, status: 'scheduled' },
      ],
      baseStart: base,
      eventEnd: end,
      matchMinutes: 60,
      betweenMatchBreakMinutes: 15,
      courtCount: 2,
    });
    expect(assignments.find((item) => item.id === 'c')?.scheduled_at).toBe(
      new Date(2026, 9, 24, 10).toISOString(),
    );
  });

  it('does not assign courts or times to walkovers', () => {
    const assignments = buildKnockoutSchedule({
      matches: [
        { id: 'bye', round_number: 1, match_number: 1, status: 'bye' },
        { id: 'real', round_number: 1, match_number: 2, status: 'scheduled' },
      ],
      baseStart: base,
      eventEnd: end,
      matchMinutes: 60,
      betweenMatchBreakMinutes: 15,
      courtCount: 2,
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].id).toBe('real');
  });
});
