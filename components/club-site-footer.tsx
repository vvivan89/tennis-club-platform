import { SiteFooter } from '@/components/site-footer';

export function ClubSiteFooter({
  club,
}: {
  club?: { club_name?: string | null; short_name?: string | null; social_links?: unknown } | null;
}) {
  return (
    <SiteFooter
      clubName={club?.club_name || undefined}
      shortName={club?.short_name || undefined}
      socialLinks={
        Array.isArray(club?.social_links) ? (club.social_links as { url: string }[]) : []
      }
    />
  );
}
