import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getClubDisplay } from '@/lib/club-display';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { MemberNav } from '@/components/member-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getRankingsData } from '@/lib/rankings-data';
import { RankingsCompetitionSelector } from '@/components/rankings-competition-selector';
import { buildRankingsCompetitionOptions } from '@/lib/rankings-competition-options';
import type { TournamentConfig } from '@/lib/tournament-config';
import {
  calculatePlayerStats,
  getSeasonYearChoices,
  isInSeason,
  medal,
  rankPlayers,
} from '@/lib/player-rankings';
type Props = {
  searchParams?: Promise<{
    season?: string | string[];
    ladder?: string | string[];
    league?: string | string[];
    tournament?: string | string[];
  }>;
};
function StatCard({
  title,
  subtitle,
  won,
  lost,
  percentage,
  progressLabel,
}: {
  title: string;
  subtitle: string;
  won: number;
  lost: number;
  percentage: number;
  progressLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Won</p>
            <p className="text-2xl font-semibold">{won}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lost</p>
            <p className="text-2xl font-semibold">{lost}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Win rate</p>
            <p className="text-2xl font-semibold">{percentage.toFixed(1)}%</p>
          </div>
        </div>
        <div
          className="mt-4 h-3 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function MemberStatsPage({ searchParams: searchParamsPromise }: Props) {
  const searchParams = await searchParamsPromise;
  const session = await createSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) redirect('/login?next=/member/results');
  const [{ data: profile }, { data: club }] = await Promise.all([
    session
      .from('profiles')
      .select('full_name,application_status,role')
      .eq('id', user.id)
      .maybeSingle(),
    session
      .from('club_settings')
      .select('club_name,short_name,social_links')
      .eq('id', 1)
      .maybeSingle(),
  ]);
  if (profile?.application_status !== 'approved') redirect('/member/dashboard');
  const data = await getRankingsData();
  if (profile.role !== 'admin' && !data.eligibleUserIds.has(user.id)) redirect('/member/dashboard');
  const { allSeasonYears, defaultYear } = getSeasonYearChoices(data.games, data.settings);
  const readParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const requested = readParam(searchParams?.season);
  const { data: registrations } = await session
    .from('registrations')
    .select('event_id')
    .eq('user_id', user.id)
    .in('status', ['confirmed', 'waitlisted']);
  const { data: tournamentParticipants } = await session
    .from('tournament_participants')
    .select('event_id')
    .eq('user_id', user.id)
    .eq('status', 'registered');
  const participatedEventIds = new Set([
    ...data.games.filter((game) => game.playerIds.includes(user.id)).map((game) => game.eventId),
    ...(registrations ?? []).map((row) => row.event_id),
    ...(tournamentParticipants ?? []).map((row) => row.event_id),
  ]);
  const participatedSeriesIds = new Set(
    data.events
      .filter((event) => participatedEventIds.has(event.id) && event.social_doubles_ladder_id)
      .map((event) => event.social_doubles_ladder_id as string),
  );
  const { data: laddersRaw } = await session
    .from('social_doubles_ladders')
    .select('id,name,gender,competition_type')
    .order('ends_at', { ascending: false, nullsFirst: false });
  const ladders = (laddersRaw ?? []) as Array<{
    id: string;
    name: string;
    gender: 'male' | 'female';
    competition_type: string;
  }>;
  const leagues = ladders.filter(
    (ladder) => ladder.competition_type === 'league' && participatedSeriesIds.has(ladder.id),
  );
  const regularLadders = ladders.filter(
    (ladder) => ladder.competition_type !== 'league' && participatedSeriesIds.has(ladder.id),
  );
  const { data: tournamentEventsRaw } = participatedEventIds.size
    ? await session
        .from('events')
        .select('id,title,tournament_config')
        .eq('event_type', 'tournament')
        .eq('tournament_format', 'doubles')
        .is('social_doubles_ladder_id', null)
        .in('status', ['published', 'cancelled'])
        .in('id', [...participatedEventIds])
    : { data: [] };
  const tournamentEvents = (tournamentEventsRaw ?? []) as Array<{
    id: string;
    title: string;
    tournament_config: TournamentConfig | null;
  }>;
  const { data: tournamentMatches } = tournamentEvents.length
    ? await session
        .from('tournament_matches')
        .select('event_id,status,score_sets,winner_side')
        .in(
          'event_id',
          tournamentEvents.map((event) => event.id),
        )
    : { data: [] };
  const tournamentResults = new Set(
    (tournamentMatches ?? [])
      .filter(
        (match) =>
          match.status === 'completed' ||
          (Array.isArray(match.score_sets) && match.score_sets.length > 0) ||
          match.winner_side != null,
      )
      .map((match) => match.event_id),
  );
  const tournaments = tournamentEvents.filter((event) => tournamentResults.has(event.id));
  const competitionOptions = buildRankingsCompetitionOptions(
    [defaultYear, ...allSeasonYears],
    regularLadders,
    leagues,
    tournaments,
  );
  const selectedLadder =
    regularLadders.find((item) => item.id === readParam(searchParams?.ladder)) ?? null;
  const selectedLeague =
    leagues.find((item) => item.id === readParam(searchParams?.league)) ?? null;
  const selectedTournament =
    tournaments.find((item) => item.id === readParam(searchParams?.tournament)) ?? null;
  const season =
    requested === 'all'
      ? 'all'
      : requested && /^\d{4}$/.test(requested) && allSeasonYears.includes(Number(requested))
        ? Number(requested)
        : defaultYear;
  const selectedSeries = selectedLadder ?? selectedLeague;
  const selectedSeriesEventIds = new Set(
    data.events
      .filter((event) => event.social_doubles_ladder_id === selectedSeries?.id)
      .map((event) => event.id),
  );
  const games = selectedTournament
    ? data.games.filter((game) => game.eventId === selectedTournament.id)
    : selectedSeries
      ? data.games.filter((game) => selectedSeriesEventIds.has(game.eventId))
      : season === 'all'
        ? data.games
        : data.games.filter((g) => isInSeason(new Date(g.playedAt), season, data.settings));
  const players = calculatePlayerStats(data.players, games);
  const ranked = rankPlayers(players.filter((p) => p.gamesPlayed > 0));
  const rank = ranked.findIndex((p) => p.id === user.id) + 1;
  const own = players.find((p) => p.id === user.id) || {
    id: user.id,
    name: profile.full_name || 'Player',
    gender: null,
    skillRating: null,
    gamesWon: 0,
    gamesLost: 0,
    setsWon: 0,
    setsLost: 0,
    gamesPercentage: 0,
    setsPercentage: 0,
    gamesPlayed: 0,
  };
  const sameGenderRanked = own.gender
    ? rankPlayers(players.filter((p) => p.gamesPlayed > 0 && p.gender === own.gender))
    : [];
  const sameGenderRank = sameGenderRanked.findIndex((p) => p.id === user.id) + 1;
  const relevant = games
    .filter((g) => g.playerIds.includes(user.id))
    .map((g) => {
      const onOne = g.sideOneIds.includes(user.id);
      const wonScore = onOne ? g.scoreOne : g.scoreTwo;
      const lostScore = onOne ? g.scoreTwo : g.scoreOne;
      const ownIds = onOne ? g.sideOneIds : g.sideTwoIds;
      const oppIds = onOne ? g.sideTwoIds : g.sideOneIds;
      return {
        id: g.id,
        eventTitle: g.eventTitle,
        playedAt: g.playedAt,
        wonScore,
        lostScore,
        won: wonScore > lostScore,
        partners: ownIds.filter((id) => id !== user.id),
        opponents: oppIds,
      };
    })
    .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
  const { clubName, shortName, socialLinks } = getClubDisplay(club);
  const seasonLabel =
    selectedTournament?.title ??
    selectedSeries?.name ??
    (season === 'all' ? 'All time' : `${season}`);
  const selectorValue = selectedTournament
    ? `tournament:${selectedTournament.id}`
    : selectedLeague
      ? `league:${selectedLeague.id}`
      : selectedLadder
        ? `ladder:${selectedLadder.id}`
        : String(season);
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} />
      <MemberNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Member portal</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="section-title">Results</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your recorded match performance and ranking.
            </p>
          </div>
          <RankingsCompetitionSelector
            value={selectorValue}
            options={competitionOptions}
            path="/member/results"
          />
        </div>
        <section aria-label="Player rankings" className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">Overall ranking</p>
            <p className="mt-1 text-xl font-semibold">
              {rank > 0 ? (
                <>
                  {medal(rank) && (
                    <span className="mr-2" aria-label={`Rank ${rank}`}>
                      {medal(rank)}
                    </span>
                  )}
                  #{rank}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    of {ranked.length}
                  </span>
                </>
              ) : (
                'Not ranked'
              )}
            </p>
          </div>
          {own.gender && (
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {own.gender === 'male' ? 'Men’s' : 'Women’s'} ranking
              </p>
              <p className="mt-1 text-xl font-semibold">
                {sameGenderRank > 0 ? (
                  <>
                    {medal(sameGenderRank) && (
                      <span className="mr-2" aria-label={`Rank ${sameGenderRank}`}>
                        {medal(sameGenderRank)}
                      </span>
                    )}
                    #{sameGenderRank}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      of {sameGenderRanked.length}
                    </span>
                  </>
                ) : (
                  'Not ranked'
                )}
              </p>
            </div>
          )}
        </section>
        <div className="mt-7 grid gap-4 lg:grid-cols-2">
          <StatCard
            title="Sets"
            subtitle={`${own.setsWon + own.setsLost} recorded results · ${seasonLabel}`}
            won={own.setsWon}
            lost={own.setsLost}
            percentage={own.setsPercentage}
            progressLabel="Sets won percentage"
          />
          <StatCard
            title="Games"
            subtitle={`${own.gamesWon + own.gamesLost} total games · ${seasonLabel}`}
            won={own.gamesWon}
            lost={own.gamesLost}
            percentage={own.gamesPercentage}
            progressLabel="Games won percentage"
          />
        </div>
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Past game scores</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium">Opponents</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {relevant.map((g) => (
                  <tr key={g.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-3">
                      {new Date(g.playedAt).toLocaleDateString('en-CA')}
                    </td>
                    <td className="px-4 py-3">{g.eventTitle}</td>
                    <td className="px-4 py-3">
                      {g.partners.map((id) => data.profileById.get(id) || 'Partner').join(', ') ||
                        '—'}
                    </td>
                    <td className="px-4 py-3">
                      {g.opponents.map((id) => data.profileById.get(id) || 'Opponent').join(', ') ||
                        '—'}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {g.wonScore}–{g.lostScore}
                    </td>
                    <td
                      className={`px-4 py-3 font-medium ${g.won ? 'text-green-700' : 'text-muted-foreground'}`}
                    >
                      {g.won ? 'Won' : g.wonScore === g.lostScore ? 'Draw' : 'Lost'}
                    </td>
                  </tr>
                ))}
                {!relevant.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No recorded scores for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socialLinks} />
    </main>
  );
}
