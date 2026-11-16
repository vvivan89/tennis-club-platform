export type LegalGuardian = { name: string; email: string; phone: string };

export const emptyLegalGuardian = (): LegalGuardian => ({ name: '', email: '', phone: '' });

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isUnder18(dateOfBirth: string, today = localDateString()) {
  const age = playerAge(dateOfBirth, today);
  return age !== null && age < 18;
}

export function playerAge(dateOfBirth: string, today = localDateString()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const [currentYear, currentMonth, currentDay] = today.split('-').map(Number);
  if (!year || !month || !day) return null;
  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age >= 0 ? age : null;
}

export function normalizeLegalGuardians(guardians: LegalGuardian[], dateOfBirth: string) {
  if (!isUnder18(dateOfBirth)) return [];
  return guardians
    .map(({ name, email, phone }) => ({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
    }))
    .filter((guardian) => guardian.name || guardian.email || guardian.phone);
}

export function validateLegalGuardians(dateOfBirth: string, guardians: LegalGuardian[]) {
  if (!isUnder18(dateOfBirth)) return;
  const normalized = normalizeLegalGuardians(guardians, dateOfBirth);
  if (!normalized.length)
    throw new Error(
      'For a player under 18, add at least one parent or legal guardian with a name and contact.',
    );
  const valid = normalized.filter(
    (guardian) => guardian.name && (guardian.email || guardian.phone),
  );
  if (valid.length !== normalized.length)
    throw new Error('Each parent or legal guardian needs a name and at least one contact method.');
}
