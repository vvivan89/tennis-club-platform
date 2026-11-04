import { TournamentAuditLog, type TournamentAuditRow } from '@/components/tournament-audit-log';
import type {
  Match,
  Member,
  Pair,
  Participant,
  Team,
} from '@/components/tournament-management-types';

type Props = {
  rows: TournamentAuditRow[];
  participants: Participant[];
  teams: Team[];
  pairs: Pair[];
  matches: Match[];
  members: Member[];
};

export function TournamentAuditSection({
  rows,
  participants,
  teams,
  pairs,
  matches,
  members,
}: Props) {
  return (
    <TournamentAuditLog
      rows={rows}
      participants={participants.map((item) => ({ id: item.id, name: item.display_name }))}
      teams={teams.map((item) => ({ id: item.id, name: item.name }))}
      pairs={pairs.map((item) => ({
        id: item.id,
        player_one_name: item.player_one_name ?? '',
        player_two_name: item.player_two_name ?? '',
      }))}
      matches={matches.map((item) => ({
        id: item.id,
        category: item.category,
        phase: item.phase,
        match_number: item.match_number,
      }))}
      members={members.map((item) => ({ id: item.id, name: item.full_name }))}
    />
  );
}
