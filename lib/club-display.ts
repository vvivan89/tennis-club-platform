type ClubLike = {
  club_name?: string | null;
  short_name?: string | null;
  social_links?: unknown;
} | null;

/** Header/footer props for a club_settings row, with the club's default names. */
export function getClubDisplay(club?: ClubLike) {
  return {
    clubName: club?.club_name || 'Port Coquitlam Tennis Club',
    shortName: club?.short_name || 'PCTC',
    socialLinks: Array.isArray(club?.social_links) ? (club.social_links as { url: string }[]) : [],
  };
}
