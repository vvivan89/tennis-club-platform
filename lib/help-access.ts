export type HelpGuide = 'public' | 'member' | 'organizer' | 'admin';

export function canAccessHelpGuide(
  guide: HelpGuide,
  role: string | null,
  approved: boolean,
): boolean {
  if (guide === 'public') return true;
  if (guide === 'member') return approved;
  if (guide === 'organizer') return role === 'organizer' || role === 'admin';
  return role === 'admin';
}
