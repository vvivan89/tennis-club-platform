import type { Assignment, Participant, Warning } from '@/components/event-edit-types';

export function validateAssignments(
  participants: Participant[],
  assignments: Assignment[],
): Warning[] {
  const confirmed = participants.filter((participant) => participant.status === 'confirmed');
  const confirmedIds = new Set(confirmed.map((participant) => participant.registration_id));
  const valid = [
    ...new Map(
      assignments
        .filter((assignment) => confirmedIds.has(assignment.registration_id))
        .map((assignment) => [
          `${assignment.registration_id}:${assignment.segment_order}:${assignment.court_number}`,
          assignment,
        ]),
    ).values(),
  ];
  const counts = confirmed.map((participant) => ({
    count: new Set(
      valid
        .filter((assignment) => assignment.registration_id === participant.registration_id)
        .map((assignment) => assignment.segment_order),
    ).size,
  }));
  const warnings: Warning[] = [];
  if (counts.some((item) => item.count > 0) && new Set(counts.map((item) => item.count)).size > 1) {
    warnings.push({
      kind: 'count',
      message: 'The number of assigned sub-sessions differs between participants.',
    });
  }

  const bySession = new Map<string, Set<string>>();
  for (const assignment of valid) {
    const key = `${assignment.segment_order}:${assignment.court_number}`;
    if (!bySession.has(key)) bySession.set(key, new Set());
    bySession.get(key)!.add(assignment.registration_id);
  }
  for (const [key, ids] of bySession) {
    if (ids.size > 4) {
      warnings.push({
        kind: 'overfull',
        message: `Sub-session ${key.split(':')[0]}, Court ${key.split(':')[1]} has ${ids.size} players (maximum 4).`,
      });
    }
  }
  return warnings;
}

export function getEligibility(
  person: { id: string; gender?: string | null },
  {
    genderRestriction,
    membershipRequired,
    paidMembershipUserIds,
  }: {
    genderRestriction?: string | null;
    membershipRequired?: boolean;
    paidMembershipUserIds: Set<string>;
  },
) {
  const genderEligible = !genderRestriction || person.gender?.toLowerCase() === genderRestriction;
  const genderStatus =
    genderRestriction && !genderEligible ? `Gender ${person.gender || 'not specified'}` : undefined;
  const membershipEligible = !membershipRequired || paidMembershipUserIds.has(person.id);
  const membershipStatus =
    membershipRequired && !membershipEligible
      ? 'Cannot register: requires an active, paid membership.'
      : undefined;

  return {
    genderEligible,
    membershipEligible,
    eligibilityReasons: [genderStatus, membershipStatus].filter(Boolean).join(' · '),
  };
}
