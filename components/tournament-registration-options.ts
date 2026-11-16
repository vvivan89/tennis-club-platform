import { isGenderEligibleForCategory, type TournamentConfig } from '@/lib/tournament-config';

export function getTournamentRegistrationOptions({
  config,
  format,
  leagueTournament,
  leagueRegistrationCategory,
  ownCategories,
  registrationGender,
  currentUserId,
}: {
  config: TournamentConfig | null;
  format: string | null;
  leagueTournament: boolean;
  leagueRegistrationCategory: string;
  ownCategories: string[];
  registrationGender: string | null;
  currentUserId: string | null;
}) {
  const singles = format === 'singles';
  const defaults = singles ? ['all', 'men', 'women'] : ['mixed', 'men', 'women'];
  const enabledCategories = (config?.categories ?? defaults).filter((category: string) =>
    singles
      ? ['all', 'men', 'women'].includes(category)
      : ['mixed', 'men', 'women'].includes(category),
  );
  const hasGenderEligibleCategory =
    format === 'team' ||
    enabledCategories.some((category: string) =>
      isGenderEligibleForCategory(category, registrationGender),
    );
  const availableCategories = (
    leagueTournament
      ? ownCategories.includes(leagueRegistrationCategory) ||
        !isGenderEligibleForCategory(leagueRegistrationCategory, registrationGender)
        ? []
        : [leagueRegistrationCategory]
      : format === 'team'
        ? ['team']
        : enabledCategories.filter(
            (category: string) =>
              !ownCategories.includes(category) &&
              !(category === 'men' && ownCategories.includes('women')) &&
              !(category === 'women' && ownCategories.includes('men')) &&
              !(
                category === 'men' &&
                registrationGender !== null &&
                registrationGender !== 'male'
              ) &&
              !(
                category === 'women' &&
                registrationGender !== null &&
                registrationGender !== 'female'
              ) &&
              !(
                category === 'mixed' &&
                registrationGender !== null &&
                !['male', 'female'].includes(registrationGender)
              ),
          )
  ).filter(() => !currentUserId || ownCategories.length < (format === 'team' ? 1 : 2));

  return { hasGenderEligibleCategory, availableCategories };
}
