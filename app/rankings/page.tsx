import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getClubDisplay } from '@/lib/club-display';
import { getRankingsData } from '@/lib/rankings-data';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RankingsTable } from '@/components/rankings-table';
import { TournamentPublicView } from '@/components/tournament-public-view';
import { RankingsCompetitionSelector } from '@/components/rankings-competition-selector';
import type { TournamentConfig } from '@/lib/tournament-config';
import { calculateLadderSession, type LadderMetric } from '@/lib/social-doubles-ladder';
import {
  calculatePlayerStats,
  getSeasonYearChoices,
  isInSeason,
  medal,
} from '@/lib/player-rankings';

type Props = {
  searchParams?: Promise<{
    season?: string | string[];
    ladder?: string | string[];
    tournament?: string | string[];
    league?: string | string[];
  }>;
};
const formatPoints = (value: number) => {
  const formatted = `${value > 0 ? '+' : ''}${value}`;
  return `${formatted} ${Math.abs(value) === 1 ? 'point' : 'points'}`;
};

const describeLadderPoints = (points: number[]) =>
  [
    `1st ${formatPoints(Number(points[0] ?? 2))}`,
    `2nd ${formatPoints(Number(points[1] ?? 1))}`,
    `3rd ${formatPoints(Number(points[2] ?? -1))}`,
    `4th ${formatPoints(Number(points[3] ?? -2))}`,
  ].join(', ');
export default async function RankingsPage({ searchParams: searchParamsPromise }: Props) {
  const searchParams = await searchParamsPromise;
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/rankings');
  const [{ data: profile }, { data: club }] = await Promise.all([
    db.from('profiles').select('application_status,role').eq('id', user.id).maybeSingle(),
    db
      .from('club_settings')
      .select('club_name,short_name,social_links,location_query')
      .eq('id', 1)
      .maybeSingle(),
  ]);
  if (profile?.application_status !== 'approved') redirect('/member/dashboard');
  const data = await getRankingsData();
  const { data: laddersRaw } = await db
    .from('social_doubles_ladders')
    .select(
      'id,name,gender,position_points,ranking_priority,starts_at,ends_at,carryover_mode,previous_ladder_id,competition_type',
    )
    .order('ends_at', { ascending: false, nullsFirst: false });
  const ladders = (laddersRaw ?? []) as Array<{
    id: string;
    name: string;
    gender: 'male' | 'female';
    position_points: number[];
    ranking_priority: string[];
    starts_at: string;
    ends_at: string | null;
    carryover_mode: 'none' | 'position' | 'full';
    previous_ladder_id: string | null;
    competition_type: string;
  }>;
  const leagues = ladders.filter((item) => item.competition_type === 'league');
  const regularLadders = ladders.filter((item) => item.competition_type !== 'league');
  const { data: tournamentsRaw } = await db
    .from('events')
    .select(
      'id,title,slug,starts_at,ends_at,status,tournament_format,tournament_config,tournament_rules_html,tournament_details_public,allow_non_member_registration,registration_opens_at,registration_closes_at,price_cents,location,court_count',
    )
    .eq('event_type', 'tournament')
    .eq('tournament_format', 'doubles')
    .is('social_doubles_ladder_id', null)
    .in('status', ['published', 'cancelled'])
    .order('starts_at', { ascending: false });
  const tournamentEvents = (tournamentsRaw ?? []) as Array<{
    id: string;
    title: string;
    slug: string;
    starts_at: string;
    ends_at: string | null;
    status: string;
    tournament_format: string | null;
    tournament_config: TournamentConfig | null;
    tournament_rules_html: string | null;
    tournament_details_public: boolean | null;
    allow_non_member_registration: boolean | null;
    registration_opens_at: string;
    registration_closes_at: string | null;
    price_cents: number | null;
    location: string | null;
    court_count: number | null;
  }>;
  const { data: tournamentMatches } = tournamentEvents.length
    ? await db
        .from('tournament_matches')
        .select('event_id,status,score_sets,winner_side')
        .in(
          'event_id',
          tournamentEvents.map((tournament) => tournament.id),
        )
    : { data: [] };
  const tournamentsWithResults = new Set(
    (tournamentMatches ?? [])
      .filter((match) => {
        const hasScore = Array.isArray(match.score_sets) && match.score_sets.length > 0;
        return match.status === 'completed' || hasScore || match.winner_side != null;
      })
      .map((match) => match.event_id),
  );
  const tournaments = tournamentEvents.filter((tournament) =>
    tournamentsWithResults.has(tournament.id),
  );
  if (profile.role !== 'admin' && !data.eligibleUserIds.has(user.id)) redirect('/member/dashboard');
  const { allSeasonYears, defaultYear } = getSeasonYearChoices(data.games, data.settings);
  const rawSeason = searchParams?.season;
  const requested = Array.isArray(rawSeason) ? rawSeason[0] : rawSeason;
  const requestedLadderRaw = searchParams?.ladder;
  const requestedLadder = Array.isArray(requestedLadderRaw)
    ? requestedLadderRaw[0]
    : requestedLadderRaw;
  const selectedLadderId =
    requestedLadder && regularLadders.some((l) => l.id === requestedLadder)
      ? requestedLadder
      : requested?.startsWith('ladder:') && ladders.some((l) => l.id === requested.slice(7))
        ? requested.slice(7)
        : null;
  const selectedLadder = regularLadders.find((l) => l.id === selectedLadderId) ?? null;
  const rawLeague = searchParams?.league;
  const requestedLeague = Array.isArray(rawLeague) ? rawLeague[0] : rawLeague;
  const selectedLeague = leagues.find((l) => l.id === requestedLeague) ?? null;
  const { data: leagueCurrent } = selectedLeague
    ? await db
        .from('league_current_standings')
        .select('standings')
        .eq('league_id', selectedLeague.id)
        .maybeSingle()
    : { data: null };
  const leagueStandings = Array.isArray(leagueCurrent?.standings)
    ? (leagueCurrent.standings as Array<Record<string, unknown>>)
    : [];
  const rawTournament = searchParams?.tournament;
  const requestedTournament = Array.isArray(rawTournament) ? rawTournament[0] : rawTournament;
  const selectedTournament = tournaments.find((t) => t.id === requestedTournament) ?? null;
  const season: number | 'all' =
    requested === 'all'
      ? 'all'
      : requested && /^\d{4}$/.test(requested) && allSeasonYears.includes(Number(requested))
        ? Number(requested)
        : defaultYear;
  const ladderEventIds = new Set(
    data.events.filter((e) => e.social_doubles_ladder_id === selectedLadderId).map((e) => e.id),
  );
  const selectedGames = selectedLadder
    ? data.games.filter((g) => ladderEventIds.has(g.eventId))
    : season === 'all'
      ? data.games
      : data.games.filter((g) => isInSeason(new Date(g.playedAt), season, data.settings));
  const players = calculatePlayerStats(data.players, selectedGames);
  const ladderPoints = new Map<string, number>();
  const pointsForLadder = (ladderId: string, priority: string[], points: number[]) => {
    const ids = new Set(
      data.events.filter((e) => e.social_doubles_ladder_id === ladderId).map((e) => e.id),
    );
    const sessions = new Map<string, typeof data.games>();
    for (const game of data.games)
      if (ids.has(game.eventId)) {
        const courtKey = `${game.eventId}:${[...game.playerIds].sort().join(',')}`;
        const list = sessions.get(courtKey) ?? [];
        list.push(game);
        sessions.set(courtKey, list);
      }
    const totals = new Map<string, number>();
    for (const session of sessions.values()) {
      const results = calculateLadderSession(
        session,
        Object.fromEntries(data.profileById),
        priority as LadderMetric[],
        [
          Number(points[0] ?? 2),
          Number(points[1] ?? 1),
          Number(points[2] ?? -1),
          Number(points[3] ?? -2),
        ],
      );
      for (const result of results)
        totals.set(result.playerId, (totals.get(result.playerId) ?? 0) + result.points);
    }
    return totals;
  };
  const ladderSeedOrder = new Map<string, number>();
  if (selectedLadder) {
    if (selectedLadder.carryover_mode === 'full' && selectedLadder.previous_ladder_id) {
      const previous = ladders.find((l) => l.id === selectedLadder.previous_ladder_id);
      if (previous)
        for (const [id, points] of pointsForLadder(
          previous.id,
          previous.ranking_priority,
          previous.position_points,
        ))
          ladderPoints.set(id, points);
    }
    for (const [id, points] of pointsForLadder(
      selectedLadder.id,
      selectedLadder.ranking_priority,
      selectedLadder.position_points,
    ))
      ladderPoints.set(id, (ladderPoints.get(id) ?? 0) + points);
    const { data: seeds } = await db
      .from('social_doubles_ladder_seeds')
      .select('user_id,initial_position,initial_points')
      .eq('ladder_id', selectedLadder.id);
    for (const seed of seeds ?? []) {
      ladderSeedOrder.set(seed.user_id, seed.initial_position);
      if (!ladderPoints.has(seed.user_id))
        ladderPoints.set(
          seed.user_id,
          selectedLadder.carryover_mode === 'full' ? seed.initial_points : 0,
        );
    }
  }
  const { clubName, shortName, socialLinks } = getClubDisplay(club);
  const competitionOptions = [
    ...[...new Set([defaultYear, ...allSeasonYears])]
      .sort((a, b) => b - a)
      .map((year) => ({ value: String(year), label: `Full ${year} season` })),
    ...regularLadders.map((ladder) => ({
      value: `ladder:${ladder.id}`,
      label: `${ladder.name} (${ladder.gender === 'male' ? "Men's" : "Women's"} ladder)`,
    })),
    ...leagues.map((league) => ({
      value: `league:${league.id}`,
      label: `${league.name} (${league.gender === 'male' ? "Men's" : "Women's"} league)`,
    })),
    ...tournaments.map((tournament) => ({
      value: `tournament:${tournament.id}`,
      label: `${tournament.title} (Doubles tournament)`,
    })),
  ];
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} />
      <div className="page-container flex-1 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="section-title">Club rankings</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {selectedTournament
                ? `Results for ${selectedTournament.title}. Group standings and knockout brackets are shown below.`
                : selectedLadder
                  ? `Ladder ranks use points: ${describeLadderPoints(selectedLadder.position_points)}.`
                  : 'Rankings are based on games-won percentage for the selected period. Players without recorded results appear at the bottom.'}
            </p>
          </div>
        </div>
        <div className="mt-7">
          {selectedLeague ? (
            <section className="space-y-4">
              <RankingsCompetitionSelector
                value={`league:${selectedLeague.id}`}
                options={competitionOptions}
              />
              <div>
                <h2 className="text-xl font-semibold">{selectedLeague.name} standings</h2>
                <p className="text-sm text-muted-foreground">
                  Current cumulative standings across completed league events.
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Rank</th>
                      <th className="px-4 py-3 text-left font-medium">Team</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Played</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Wins</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Points</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Sets</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Games</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leagueStandings.map((row, index) => {
                      const rank = Number(row.position ?? index + 1);
                      const isMe = row.player_one_id === user.id || row.player_two_id === user.id;
                      const rankMedal = medal(rank);
                      return (
                        <tr
                          key={String(row.team_id ?? index)}
                          className={`border-t border-border ${isMe ? 'bg-primary/10 font-medium' : ''}`}
                        >
                          <td className="whitespace-nowrap px-4 py-3">
                            <span className="inline-flex min-w-8 items-center gap-1.5">
                              {rankMedal && (
                                <span
                                  aria-label={`Rank ${rank}`}
                                  title={`Rank ${rank}`}
                                  className="text-base"
                                >
                                  {rankMedal}
                                </span>
                              )}
                              <span>{rank}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {String(row.team_name ?? '')}
                            {isMe && (
                              <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                                You
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {String(row.matches_played ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right">{String(row.wins ?? 0)}</td>
                          <td className="px-4 py-3 text-right">{String(row.points ?? 0)}</td>
                          <td className="px-4 py-3 text-right">
                            {String(row.sets_won ?? 0)}–{String(row.sets_lost ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {String(row.games_won ?? 0)}–{String(row.games_lost ?? 0)}
                          </td>
                        </tr>
                      );
                    })}
                    {!leagueStandings.length && (
                      <tr>
                        <td className="p-4 text-muted-foreground" colSpan={7}>
                          No league standings are available yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : selectedTournament ? (
            <TournamentPublicView
              key={selectedTournament.id}
              eventTitle={selectedTournament.title}
              eventId={selectedTournament.id}
              currentUserId={user.id}
              format={selectedTournament.tournament_format}
              config={selectedTournament.tournament_config ?? {}}
              rulesHtml={selectedTournament.tournament_rules_html ?? ''}
              detailsPublic={selectedTournament.tournament_details_public !== false}
              allowNonMemberRegistration={selectedTournament.allow_non_member_registration === true}
              eventStatus={selectedTournament.status}
              startsAt={selectedTournament.starts_at}
              endsAt={selectedTournament.ends_at}
              locationQuery={club?.location_query || selectedTournament.location || ''}
              registrationOpensAt={selectedTournament.registration_opens_at}
              registrationClosesAt={selectedTournament.registration_closes_at}
              priceCents={selectedTournament.price_cents ?? 0}
              resultsOnly
              rankingsControl={
                <RankingsCompetitionSelector
                  value={`tournament:${selectedTournament.id}`}
                  options={competitionOptions}
                />
              }
            />
          ) : (
            <RankingsTable
              players={players}
              currentUserId={user.id}
              ladderPoints={selectedLadder ? ladderPoints : undefined}
              ladderRankingPriority={selectedLadder?.ranking_priority}
              ladderSeedOrder={selectedLadder ? ladderSeedOrder : undefined}
              ladderPositionPoints={selectedLadder?.position_points}
              competitionSelector={
                <RankingsCompetitionSelector
                  value={selectedLadder ? `ladder:${selectedLadder.id}` : String(season)}
                  options={competitionOptions}
                />
              }
            />
          )}
        </div>
      </div>
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socialLinks} />
    </main>
  );
}
