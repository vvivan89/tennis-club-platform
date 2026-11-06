import { formatDateTime } from '@/lib/time-format';

export type TournamentAuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

type AuditEntity = { id: string; name: string };
type AuditPair = { id: string; player_one_name: string; player_two_name: string };
type AuditMatch = {
  id: string;
  category: string;
  phase: string;
  match_number: number;
};

function summarizeAuditData(data: Record<string, unknown> | null) {
  if (!data) return '';
  const labels: Record<string, string> = {
    name: 'Name',
    display_name: 'Participant',
    category: 'Category',
    status: 'Status',
    payment_status: 'Payment status',
    group_number: 'Group',
    scheduled_at: 'Scheduled for',
    court_number: 'Court',
    score_sets: 'Set scores',
    winner_side: 'Winner side',
    team_points_one: 'Team one points',
    team_points_two: 'Team two points',
    color: 'Team colour',
  };

  return Object.entries(data)
    .filter(([key, value]) => labels[key] && value !== null)
    .map(([key, value]) => {
      if (key === 'score_sets' && Array.isArray(value)) {
        const scores = value
          .map((set) =>
            set && typeof set === 'object'
              ? `${String((set as { one?: unknown }).one)}-${String((set as { two?: unknown }).two)}`
              : '',
          )
          .join(', ');
        return `${labels[key]}: ${scores}`;
      }
      if (key === 'scheduled_at' && typeof value === 'string') {
        return `${labels[key]}: ${formatDateTime(value)}`;
      }
      if (typeof value === 'object') return '';
      return `${labels[key]}: ${String(value)}`;
    })
    .filter(Boolean)
    .join(' · ');
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function TournamentAuditLog({
  rows,
  participants,
  teams,
  pairs,
  matches,
  members,
}: {
  rows: TournamentAuditRow[];
  participants: AuditEntity[];
  teams: AuditEntity[];
  pairs: AuditPair[];
  matches: AuditMatch[];
  members: AuditEntity[];
}) {
  const entityName = (row: TournamentAuditRow) => {
    if (row.entity_type.includes('participant')) {
      return participants.find((item) => item.id === row.entity_id)?.name;
    }
    if (row.entity_type.includes('team')) {
      return teams.find((item) => item.id === row.entity_id)?.name;
    }
    if (row.entity_type.includes('pair')) {
      const pair = pairs.find((item) => item.id === row.entity_id);
      return pair ? `${pair.player_one_name} + ${pair.player_two_name}` : 'Doubles pair';
    }
    if (row.entity_type.includes('match')) {
      const match = matches.find((item) => item.id === row.entity_id);
      return match
        ? `${match.category} ${match.phase.replaceAll('_', ' ')} match ${match.match_number}`
        : 'Match';
    }
    return row.entity_type.replaceAll('tournament_', '').replaceAll('_', ' ');
  };

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="font-semibold">Tournament audit log ({rows.length} recent changes)</h3>
      <div className="mt-3 space-y-2">
        {rows.map((row) => {
          const actorName =
            members.find((member) => member.id === row.actor_user_id)?.name || 'Club administrator';
          const before = summarizeAuditData(row.before_data);
          const after = summarizeAuditData(row.after_data);
          const entity = entityName(row) || 'Tournament record';

          return (
            <article key={row.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">
                  {titleCase(row.action.replaceAll('_', ' '))} · {titleCase(entity)}
                </span>
                <time className="text-xs text-muted-foreground">
                  {formatDateTime(row.created_at)}
                </time>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">By {actorName}</p>
              {(before || after) && (
                <div className="mt-3 space-y-2 text-sm">
                  {before && (
                    <div className="rounded-md bg-secondary/40 p-2">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Before
                      </p>
                      <p>{before}</p>
                    </div>
                  )}
                  {after && (
                    <div className="rounded-md bg-success/5 p-2">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        After
                      </p>
                      <p>{after}</p>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {!rows.length && (
          <p className="text-sm text-muted-foreground">
            No tournament changes have been logged yet.
          </p>
        )}
      </div>
    </section>
  );
}
