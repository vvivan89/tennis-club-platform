export type DoublesCompetitionGender = 'male' | 'female' | 'mixed';

export function doublesCategoryForGender(gender: string | null | undefined) {
  if (gender === 'male') return 'men';
  if (gender === 'female') return 'women';
  return 'mixed';
}

export function isStrictMixedDoublesPair(
  firstGender: string | null | undefined,
  secondGender: string | null | undefined,
) {
  const first = firstGender?.trim().toLowerCase();
  const second = secondGender?.trim().toLowerCase();
  return (first === 'male' && second === 'female') || (first === 'female' && second === 'male');
}
