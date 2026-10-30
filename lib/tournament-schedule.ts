export type PrerequisiteScheduleMatch = {
  scheduled_at: string | null;
  status: string;
};

/**
 * Returns the earliest start time for a phase after all scheduled prerequisite
 * matches have finished, with a minimum break between phases. Matches that are
 * still expected to be played must already have a scheduled start time.
 */
export function phaseStartAfterPrerequisites(options: {
  baseStart: Date | string;
  prerequisiteMatches: PrerequisiteScheduleMatch[];
  matchMinutes: number;
  minimumBreakMinutes?: number;
}): Date {
  const { baseStart, prerequisiteMatches, matchMinutes, minimumBreakMinutes = 60 } = options;
  let earliestStart = new Date(baseStart).getTime();
  if (!Number.isFinite(earliestStart)) {
    throw new Error('A valid event start time is required to suggest a schedule.');
  }

  const durationMs = Math.max(30, matchMinutes) * 60_000;
  const breakMs = Math.max(60, minimumBreakMinutes) * 60_000;
  for (const match of prerequisiteMatches) {
    if (!match.scheduled_at) {
      if (match.status !== 'completed' && match.status !== 'bye' && match.status !== 'cancelled') {
        throw new Error(
          'Schedule the preceding tournament phase before suggesting this phase schedule.',
        );
      }
      continue;
    }
    const start = new Date(match.scheduled_at).getTime();
    if (!Number.isFinite(start)) {
      throw new Error('A preceding match has an invalid scheduled start time.');
    }
    earliestStart = Math.max(earliestStart, start + durationMs + breakMs);
  }

  return new Date(earliestStart);
}

export type KnockoutScheduleMatch = {
  id: string;
  round_number: number;
  match_number: number;
  status: string;
};

export type KnockoutScheduleAssignment = {
  id: string;
  scheduled_at: string;
  court_number: number;
};

/**
 * Schedules knockout matches in parallel waves within each round. A wave uses
 * all available courts at one start time; overflow matches use a later wave.
 * Each subsequent round starts at least one hour after the preceding round's
 * last match ends.
 */
export function buildKnockoutSchedule(options: {
  matches: KnockoutScheduleMatch[];
  baseStart: Date | string;
  eventEnd: Date | string;
  matchMinutes: number;
  betweenMatchBreakMinutes: number;
  courtCount: number;
  stageBreakMinutes?: number;
}): KnockoutScheduleAssignment[] {
  const {
    matches,
    baseStart,
    eventEnd,
    matchMinutes,
    betweenMatchBreakMinutes,
    courtCount,
    stageBreakMinutes = 60,
  } = options;
  const duration = Math.max(30, matchMinutes);
  const betweenBreak = Math.max(0, betweenMatchBreakMinutes);
  const stageBreak = Math.max(60, stageBreakMinutes);
  const courts = Math.max(1, Math.floor(courtCount));
  const endMs = new Date(eventEnd).getTime();
  let roundStart = new Date(baseStart);
  if (!Number.isFinite(roundStart.getTime()) || !Number.isFinite(endMs)) {
    throw new Error('A valid tournament start and end time are required to suggest a schedule.');
  }

  const scheduled: KnockoutScheduleAssignment[] = [];
  const rounds = [...new Set(matches.map((match) => match.round_number))].sort((a, b) => a - b);
  for (const round of rounds) {
    const roundMatches = matches
      .filter(
        (match) =>
          match.round_number === round && match.status !== 'bye' && match.status !== 'cancelled',
      )
      .sort((a, b) => a.match_number - b.match_number);
    if (!roundMatches.length) continue;

    let waveStart = new Date(roundStart);
    let latestMatchEnd = 0;
    for (let offset = 0; offset < roundMatches.length; offset += courts) {
      waveStart = normalizeKnockoutStart(waveStart);
      const wave = roundMatches.slice(offset, offset + courts);
      const waveEnd = waveStart.getTime() + duration * 60_000;
      if (waveEnd > endMs) {
        throw new Error(
          'The draw was created, but there is not enough time to schedule all rounds within the tournament dates. Extend the tournament dates or reduce the number of entries.',
        );
      }
      wave.forEach((match, index) => {
        scheduled.push({
          id: match.id,
          scheduled_at: waveStart.toISOString(),
          court_number: index + 1,
        });
      });
      latestMatchEnd = Math.max(latestMatchEnd, waveEnd);
      waveStart = new Date(waveEnd + betweenBreak * 60_000);
    }
    roundStart = new Date(latestMatchEnd + stageBreak * 60_000);
  }
  return scheduled;
}

function normalizeKnockoutStart(start: Date): Date {
  const normalized = new Date(start);
  if (normalized.getHours() < 8) normalized.setHours(8, 0, 0, 0);
  else normalized.setSeconds(0, 0);
  if (normalized.getHours() > 21 || (normalized.getHours() === 21 && normalized.getMinutes() > 0)) {
    normalized.setDate(normalized.getDate() + 1);
    normalized.setHours(8, 0, 0, 0);
  }
  return normalized;
}
