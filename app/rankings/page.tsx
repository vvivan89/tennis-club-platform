import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getRankingsData } from '@/lib/rankings-data';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RankingsTable } from '@/components/rankings-table';
import { SeasonSelector } from '@/components/season-selector';
import { calculatePlayerStats, getSeasonYear, isInSeason } from '@/lib/player-rankings';

type Props = { searchParams?: { season?: string | string[] } };
export default async function RankingsPage({ searchParams }: Props) {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/rankings');
  const [{ data: profile }, { data: club }] = await Promise.all([
    db.from('profiles').select('application_status,role').eq('id', user.id).maybeSingle(),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  if (profile?.application_status !== 'approved') redirect('/member/dashboard');
  const data = await getRankingsData();
  if (profile.role !== 'admin' && !data.eligibleUserIds.has(user.id)) redirect('/member/dashboard');
  const allSeasonYears = [
    ...new Set(data.games.map((g) => getSeasonYear(new Date(g.playedAt), data.settings))),
  ].sort((a, b) => b - a);
  const currentSeasonYear = getSeasonYear(new Date(), data.settings);
  const defaultYear = allSeasonYears.includes(currentSeasonYear)
    ? currentSeasonYear
    : (allSeasonYears[0] ?? currentSeasonYear);
  const rawSeason = searchParams?.season;
  const requested = Array.isArray(rawSeason) ? rawSeason[0] : rawSeason;
  const season: number | 'all' =
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
  const clubName = club?.club_name || 'Port Coquitlam Tennis Club';
  const shortName = club?.short_name || 'PCTC';
  const socialLinks = Array.isArray(club?.social_links)
    ? (club.social_links as { url: string }[])
    : [];
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} />
      <div className="page-container flex-1 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="section-title">Club rankings</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Rankings are based on games-won percentage for the selected period. Players without
              recorded results appear at the bottom.
            </p>
          </div>
          <SeasonSelector
            path="/rankings"
            season={String(season)}
            years={[...new Set([defaultYear, ...allSeasonYears])].sort((a, b) => b - a)}
          />
        </div>
        <div className="mt-7">
          <RankingsTable players={players} currentUserId={user.id} />
        </div>
      </div>
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socialLinks} />
    </main>
  );
}
