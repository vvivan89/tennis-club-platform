import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getClubDisplay } from '@/lib/club-display';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { MemberNav } from '@/components/member-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getRankingsData } from '@/lib/rankings-data';
import {
  calculatePlayerStats,
  getSeasonYearChoices,
  isInSeason,
  medal,
  rankPlayers,
} from '@/lib/player-rankings';
import { SeasonSelector } from '@/components/season-selector';

type Props = { searchParams?: Promise<{ season?: string | string[] }> };
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
  const requestedValue = searchParams?.season;
  const requested = Array.isArray(requestedValue) ? requestedValue[0] : requestedValue;
  const season =
    requested === 'all'
      ? 'all'
      : requested && /^\d{4}$/.test(requested) && allSeasonYears.includes(Number(requested))
        ? Number(requested)
        : defaultYear;
  const games =
    season === 'all'
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
  const seasonLabel = season === 'all' ? 'All time' : `${season}`;
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
          <SeasonSelector
            path="/member/results"
            season={String(season)}
            years={[...new Set([defaultYear, ...allSeasonYears])].sort((a, b) => b - a)}
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
