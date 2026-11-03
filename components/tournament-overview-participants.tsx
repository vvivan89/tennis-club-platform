import type { Match, Pair, Participant, Team } from '@/components/tournament-public-view-types';
import { dateLabel } from '@/components/tournament-public-view-format';

type Props = {
  canViewCompetition: boolean;
  format: string | null;
  teams: Team[];
  activeCategory: string;
  participants: Participant[];
  pairs: Pair[];
  leagueTournament: boolean;
  leagueCourtView: 'courts' | 'list';
  setLeagueCourtView: (view: 'courts' | 'list') => void;
  activeLeaguePairs: Pair[];
  leaguePairs: Pair[];
  leagueCourtAssignments: Array<{ pair_id: string; court_number: number; segment_order: number }>;
  matches: Match[];
  unpairedLeagueParticipants: Participant[];
  courtTotal: number;
  leagueTimeSlots: string[];
  leagueScheduledMatches: Match[];
  ownTeamIds: string[];
  ownParticipantIds: string[];
  isOwnPair: (pairId: string | null | undefined) => boolean;
};

export function TournamentOverviewParticipants({
  canViewCompetition,
  format,
  teams,
  activeCategory,
  participants,
  pairs,
  leagueTournament,
  leagueCourtView,
  setLeagueCourtView,
  activeLeaguePairs,
  leaguePairs,
  leagueCourtAssignments,
  matches,
  unpairedLeagueParticipants,
  courtTotal,
  leagueTimeSlots,
  leagueScheduledMatches,
  ownTeamIds,
  ownParticipantIds,
  isOwnPair,
}: Props) {
  return (
    <>
      {canViewCompetition &&
        (format === 'team'
          ? teams.length > 0
          : participants.some(
              (participant) =>
                participant.category === activeCategory && participant.status === 'registered',
            ) ||
            pairs.some(
              (pair) => pair.category === activeCategory && pair.status !== 'withdrawn',
            )) && (
          <section
            className={
              leagueTournament ? 'order-4 space-y-4' : 'rounded-lg border border-border p-4'
            }
            aria-label={leagueTournament ? 'Players and courts' : 'Registered Participants'}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className={leagueTournament ? 'text-xl font-semibold' : 'font-semibold'}>
                  {leagueTournament ? 'Players and courts' : 'Registered Participants'}
                </h3>
                {leagueTournament && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Court assignments are shown for each sub-session.
                  </p>
                )}
              </div>
              {leagueTournament && (
                <div
                  className="flex gap-1 rounded-lg border border-border p-1"
                  role="group"
                  aria-label="Players and courts view"
                >
                  <button
                    type="button"
                    aria-pressed={leagueCourtView === 'courts'}
                    onClick={() => setLeagueCourtView('courts')}
                    className={`rounded px-2 py-1.5 text-sm ${leagueCourtView === 'courts' ? 'bg-secondary' : ''}`}
                  >
                    Court view
                  </button>
                  <button
                    type="button"
                    aria-pressed={leagueCourtView === 'list'}
                    onClick={() => setLeagueCourtView('list')}
                    className={`rounded px-2 py-1.5 text-sm ${leagueCourtView === 'list' ? 'bg-secondary' : ''}`}
                  >
                    List view
                  </button>
                </div>
              )}
            </div>
            {leagueTournament && format !== 'team' ? (
              leagueCourtView === 'list' ? (
                <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Player 1</th>
                        <th className="px-3 py-2">Player 2</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Court assignments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeLeaguePairs.map((pair, index) => {
                        const assignedMatches = matches
                          .filter(
                            (match) =>
                              match.pair_one_id === pair.id || match.pair_two_id === pair.id,
                          )
                          .filter((match) => match.scheduled_at || match.court_number);
                        const assignedCourts = leagueCourtAssignments.filter(
                          (assignment) => assignment.pair_id === pair.id,
                        );
                        const pairParticipants = participants.filter(
                          (participant) =>
                            participant.id === pair.player_one_id ||
                            participant.id === pair.player_two_id,
                        );
                        return (
                          <tr key={pair.id} className="border-t border-border">
                            <td className="px-3 py-2">{index + 1}</td>
                            <td className="px-3 py-2">
                              {pair.player_one_name || 'Member'}
                              {pair.player_one_skill_level != null && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {pair.player_one_skill_level}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {pair.player_two_name || 'Member'}
                              {pair.player_two_skill_level != null && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {pair.player_two_skill_level}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {pairParticipants.some(
                                (participant) => participant.status === 'registered',
                              )
                                ? 'Registered'
                                : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {assignedCourts.length
                                ? assignedCourts
                                    .sort((a, b) => a.segment_order - b.segment_order)
                                    .map((assignment) => `Court ${assignment.court_number}`)
                                    .join(' → ')
                                : assignedMatches.length
                                  ? assignedMatches
                                      .map(
                                        (match) =>
                                          `${match.court_number ? `Court ${match.court_number}` : 'Court TBD'}${match.scheduled_at ? ` · ${dateLabel(match.scheduled_at)}` : ''}`,
                                      )
                                      .join(' / ')
                                  : 'Not assigned'}
                            </td>
                          </tr>
                        );
                      })}
                      {unpairedLeagueParticipants.map((participant, index) => (
                        <tr key={participant.id} className="border-t border-border">
                          <td className="px-3 py-2">{activeLeaguePairs.length + index + 1}</td>
                          <td className="px-3 py-2">
                            {participant.display_name}
                            {participant.tennis_skill_level != null && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {participant.tennis_skill_level}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">—</td>
                          <td className="px-3 py-2">Registered</td>
                          <td className="px-3 py-2">Not assigned</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-4 space-y-6">
                  {leagueCourtAssignments.length > 0 && (
                    <section>
                      <h4 className="mb-3 text-lg font-semibold">Team court assignments</h4>
                      <div className="space-y-4">
                        {Array.from(
                          new Set(leagueCourtAssignments.map((item) => item.segment_order)),
                        )
                          .sort((a, b) => a - b)
                          .map((slot) => (
                            <div key={slot}>
                              <h5 className="mb-2 font-medium">Sub-session {slot}</h5>
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                {Array.from({ length: courtTotal }, (_, index) => index + 1)
                                  .map((court) => ({
                                    court,
                                    pairs: leagueCourtAssignments
                                      .filter(
                                        (assignment) =>
                                          assignment.segment_order === slot &&
                                          assignment.court_number === court,
                                      )
                                      .map((assignment) =>
                                        leaguePairs.find((pair) => pair.id === assignment.pair_id),
                                      )
                                      .filter((pair): pair is Pair => !!pair),
                                  }))
                                  .map(({ court, pairs: courtPairs }) => (
                                    <div
                                      key={court}
                                      className="rounded-xl border border-border p-3"
                                    >
                                      <h6 className="font-semibold">Court {court}</h6>
                                      <div className="mt-2 space-y-2 text-sm">
                                        {courtPairs.map((pair) => (
                                          <p key={pair.id}>
                                            {pair.player_one_name} + {pair.player_two_name}
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </section>
                  )}
                  {!leagueTimeSlots.length && !leagueCourtAssignments.length && (
                    <p className="text-sm text-muted-foreground">No court assignments yet.</p>
                  )}
                  {leagueTimeSlots.map((slot) => {
                    const slotMatches = leagueScheduledMatches.filter(
                      (match) => (match.scheduled_at || 'unscheduled') === slot,
                    );
                    const courts = Array.from(
                      new Set(slotMatches.map((match) => match.court_number)),
                    ).sort((a, b) => Number(a) - Number(b));
                    return (
                      <section key={slot}>
                        <h4 className="mb-3 text-lg font-semibold">
                          Sub-session {slot === 'unscheduled' ? 'to be announced' : dateLabel(slot)}
                        </h4>
                        <div className="grid gap-4 sm:grid-cols-2">
                          {courts.map((court) => (
                            <div key={court} className="rounded-xl border border-border p-4">
                              <h5 className="font-semibold">Court {court}</h5>
                              <div className="mt-3 space-y-2">
                                {slotMatches
                                  .filter((match) => match.court_number === court)
                                  .map((match) => (
                                    <div
                                      key={match.id}
                                      className="rounded-md bg-muted/40 px-3 py-2 text-sm"
                                    >
                                      <span className="mr-1 text-xs text-muted-foreground">
                                        {match.match_number}.
                                      </span>
                                      <span className="font-medium">
                                        {match.player_one_name || 'Team 1'}
                                      </span>
                                      <span> vs </span>
                                      <span className="font-medium">
                                        {match.opponent_one_name || 'Team 2'}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                  {unpairedLeagueParticipants.length > 0 && (
                    <section className="rounded-md border border-dashed border-border p-3 sm:col-span-2">
                      <h4 className="font-medium">Players without an assigned team</h4>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {unpairedLeagueParticipants
                          .map((participant) => participant.display_name)
                          .join(', ')}
                      </p>
                    </section>
                  )}
                </div>
              )
            ) : null}
            {!leagueTournament &&
              (format === 'team' ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {teams.map((team) => (
                    <div
                      key={team.id}
                      className={`rounded-md border p-3 text-sm ${ownTeamIds.includes(team.id) ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'}`}
                    >
                      <p className="font-medium">
                        {team.name}
                        {ownTeamIds.includes(team.id) && (
                          <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                            You
                          </span>
                        )}
                      </p>
                      <ul className="mt-2 space-y-1 text-muted-foreground">
                        {participants
                          .filter((participant) => participant.team_id === team.id)
                          .map((participant) => (
                            <li key={participant.id} className="flex items-center gap-2">
                              <span>{participant.display_name}</span>
                              {participant.tennis_skill_level != null && (
                                <span className="inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  {participant.tennis_skill_level}
                                </span>
                              )}
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <>
                    {pairs
                      .filter(
                        (pair) => pair.category === activeCategory && pair.status !== 'withdrawn',
                      )
                      .map((pair) => (
                        <div
                          key={pair.id}
                          className={`rounded-md border p-3 text-sm ${isOwnPair(pair.id) ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'}`}
                        >
                          <span>{pair.player_one_name}</span>
                          {pair.player_one_skill_level != null && (
                            <span className="ml-1 inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {pair.player_one_skill_level}
                            </span>
                          )}{' '}
                          + <span>{pair.player_two_name}</span>
                          {pair.player_two_skill_level != null && (
                            <span className="ml-1 inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {pair.player_two_skill_level}
                            </span>
                          )}
                          {isOwnPair(pair.id) && (
                            <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                              You
                            </span>
                          )}
                        </div>
                      ))}
                    {participants
                      .filter(
                        (participant) =>
                          participant.category === activeCategory &&
                          participant.status === 'registered' &&
                          !pairs.some(
                            (pair) =>
                              pair.status !== 'withdrawn' &&
                              pair.category === activeCategory &&
                              (pair.player_one_id === participant.id ||
                                pair.player_two_id === participant.id),
                          ),
                      )
                      .map((participant) => (
                        <div
                          key={participant.id}
                          className={`rounded-md border p-3 text-sm ${ownParticipantIds.includes(participant.id) ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'}`}
                        >
                          <span>{participant.display_name}</span>
                          {participant.tennis_skill_level != null && (
                            <span className="ml-1 inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {participant.tennis_skill_level}
                            </span>
                          )}
                          {ownParticipantIds.includes(participant.id) && (
                            <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                              You
                            </span>
                          )}
                        </div>
                      ))}
                  </>
                </div>
              ))}
            {leagueTournament && canViewCompetition && (
              <div className="mt-5 rounded-xl border border-border p-4">
                <h3 className="font-semibold">Waitlist</h3>
                {participants.some(
                  (participant) =>
                    participant.category === activeCategory && participant.status === 'waitlisted',
                ) ? (
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
                    {participants
                      .filter(
                        (participant) =>
                          participant.category === activeCategory &&
                          participant.status === 'waitlisted',
                      )
                      .map((participant) => (
                        <li key={participant.id}>{participant.display_name}</li>
                      ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No one is on the waitlist.</p>
                )}
              </div>
            )}
          </section>
        )}
    </>
  );
}
