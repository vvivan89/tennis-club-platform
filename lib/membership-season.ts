export type MembershipSeasonSettings = {
  season_start_month: number;
  season_start_day: number;
  season_end_month: number;
  season_end_day: number;
};

export type MembershipSeason = {
  year: number;
  startsOn: string;
  endsOn: string;
};

export const DEFAULT_MEMBERSHIP_SEASON_SETTINGS: MembershipSeasonSettings = {
  season_start_month: 4,
  season_start_day: 1,
  season_end_month: 9,
  season_end_day: 30,
};

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Returns the configured season containing `now`, using local calendar dates. */
export function getMembershipSeason(
  settings: MembershipSeasonSettings | null,
  now = new Date(),
): MembershipSeason | null {
  if (!settings) return null;

  const startThisYear = new Date(
    now.getFullYear(),
    settings.season_start_month - 1,
    settings.season_start_day,
  );
  const endThisYear = new Date(
    now.getFullYear(),
    settings.season_end_month - 1,
    settings.season_end_day,
    23,
    59,
    59,
    999,
  );
  const year =
    now < startThisYear
      ? now.getFullYear()
      : now > endThisYear
        ? now.getFullYear() + 1
        : now.getFullYear();

  return {
    year,
    startsOn: toDateKey(new Date(year, settings.season_start_month - 1, settings.season_start_day)),
    endsOn: toDateKey(new Date(year, settings.season_end_month - 1, settings.season_end_day)),
  };
}
