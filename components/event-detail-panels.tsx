'use client';

import type { FormEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TennisLoader } from '@/components/tennis-loader';

export type EventRosterRow = {
  registration_id: string;
  user_id: string;
  status: string;
  payment_status?: string | null;
  queue_position: number | null;
  full_name: string;
  avatar_url: string | null;
  tennis_skill_level: number | null;
  email?: string | null;
  phone?: string | null;
};
export type EventCourtRow = {
  registration_id: string;
  court_number: number;
  segment_order: number;
};
export type EventScoreRow = {
  id: string;
  player_one_registration_id: string;
  player_two_registration_id: string;
  player_three_registration_id: string | null;
  player_four_registration_id: string | null;
  player_one_score: number;
  player_two_score: number;
  player_one_name: string;
  player_two_name: string;
  player_three_name: string | null;
  player_four_name: string | null;
  played_at: string;
  entered_by?: string | null;
};

export function RosterSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  options: { registration_id: string; full_name: string | null }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      {label}
      <select
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="block h-10 w-full rounded-md border border-input bg-background px-3"
      >
        <option value="">{placeholder}</option>
        {options.map((player) => (
          <option key={player.registration_id} value={player.registration_id}>
            {player.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EventParticipantsPanel({
  eventCourtCount,
  eventPriceCents,
  view,
  setView,
  subsessions,
  courtNumbers,
  liveCourts,
  confirmed,
  isManager,
  waitlisted,
}: {
  eventCourtCount: number;
  eventPriceCents: number;
  view: 'courts' | 'list';
  setView: (view: 'courts' | 'list') => void;
  subsessions: number[];
  courtNumbers: number[];
  liveCourts: EventCourtRow[];
  confirmed: EventRosterRow[];
  isManager: boolean;
  waitlisted: EventRosterRow[];
}) {
  return (
    <>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Players and courts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Court assignments are shown for each time slot.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-border p-1">
            <Button
              size="sm"
              variant={view === 'courts' ? 'secondary' : 'ghost'}
              onClick={() => setView('courts')}
            >
              Court view
            </Button>
            <Button
              size="sm"
              variant={view === 'list' ? 'secondary' : 'ghost'}
              onClick={() => setView('list')}
            >
              List view
            </Button>
          </div>
        </div>
        {view === 'courts' ? (
          <div className="mt-4 space-y-6">
            {!subsessions.length && (
              <p className="text-sm text-muted-foreground">No court assignments yet.</p>
            )}
            {subsessions.map((session) => (
              <section key={session}>
                <h3 className="mb-3 text-lg font-semibold">Time slot {session}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(courtNumbers.length
                    ? courtNumbers
                    : Array.from({ length: eventCourtCount || 4 }, (_, index) => index + 1)
                  ).map((court) => {
                    const assigned = liveCourts.filter(
                      (item) => item.court_number === court && item.segment_order === session,
                    );
                    const peopleOnCourt = assigned
                      .map((assignment) =>
                        confirmed.find(
                          (player) => player.registration_id === assignment.registration_id,
                        ),
                      )
                      .filter((player): player is EventRosterRow => !!player)
                      .sort((a, b) => a.full_name.localeCompare(b.full_name));
                    if (!peopleOnCourt.length) return null;
                    return (
                      <div key={court} className="rounded-xl border border-border p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold">Court {court}</h4>
                          <span className="text-xs text-muted-foreground">
                            {peopleOnCourt.length} players
                          </span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {peopleOnCourt.map((player) => (
                            <div
                              key={player.registration_id}
                              className="rounded-md bg-muted/40 px-3 py-2 text-sm"
                            >
                              <span className="mr-1 text-xs text-muted-foreground">
                                {confirmed.findIndex(
                                  (item) => item.registration_id === player.registration_id,
                                ) + 1}
                                .
                              </span>
                              <span className="font-medium">{player.full_name || 'Member'}</span>
                              {player.tennis_skill_level != null && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {player.tennis_skill_level}
                                </span>
                              )}
                              {isManager && (player.email || player.phone) && (
                                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                                  {player.email && (
                                    <a href={`mailto:${player.email}`} className="hover:underline">
                                      {player.email}
                                    </a>
                                  )}
                                  {player.phone && (
                                    <a href={`tel:${player.phone}`} className="hover:underline">
                                      {player.phone}
                                    </a>
                                  )}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Court assignments</th>
                </tr>
              </thead>
              <tbody>
                {confirmed.map((player, index) => (
                  <tr key={player.registration_id} className="border-t border-border">
                    <td className="px-4 py-3">{index + 1}</td>
                    <td className="px-4 py-3">
                      <span>
                        {player.full_name || 'Member'}
                        {player.tennis_skill_level != null && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {player.tennis_skill_level}
                          </span>
                        )}
                      </span>
                      {isManager && (player.email || player.phone) && (
                        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {player.email && (
                            <a href={`mailto:${player.email}`} className="hover:underline">
                              {player.email}
                            </a>
                          )}
                          {player.phone && (
                            <a href={`tel:${player.phone}`} className="hover:underline">
                              {player.phone}
                            </a>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {eventPriceCents > 0 &&
                      player.payment_status !== 'paid' &&
                      player.payment_status !== 'not_required'
                        ? 'Pending'
                        : 'Confirmed'}
                    </td>
                    <td className="px-4 py-3">
                      {liveCourts
                        .filter((court) => court.registration_id === player.registration_id)
                        .sort((a, b) => a.segment_order - b.segment_order)
                        .map((court) => `Court ${court.court_number}`)
                        .join(' → ') || 'Not assigned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-5 rounded-xl border border-border p-4">
          <h3 className="font-semibold">Waitlist</h3>
          {waitlisted.length ? (
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
              {waitlisted.map((player) => (
                <li key={player.registration_id}>
                  {player.full_name || 'Member'}{' '}
                  <span className="text-muted-foreground">(position {player.queue_position})</span>
                  {isManager && (player.email || player.phone) && (
                    <span className="ml-2 inline-flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {player.email && (
                        <a href={`mailto:${player.email}`} className="hover:underline">
                          {player.email}
                        </a>
                      )}
                      {player.phone && (
                        <a href={`tel:${player.phone}`} className="hover:underline">
                          {player.phone}
                        </a>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No one is on the waitlist.</p>
          )}
        </div>
      </section>
    </>
  );
}

export function EventScoresPanel({
  scores,
  playerLabel,
  editingScore,
  setEditingScore,
  editScoreOne,
  setEditScoreOne,
  editScoreTwo,
  setEditScoreTwo,
  saveEditedScore,
  busy,
  scoreEditLocked,
  isAdmin,
  currentUserId,
  setDeletingScore,
  clearError,
  currentUserCanAddScore,
  event,
  eventHasStarted,
  formatDateTime,
  addScore,
  isManager,
  scoreCourt,
  setScoreCourt,
  setScorePlayerOne,
  setPartner,
  scoreCourts,
  courtPlayers,
  scorePlayerOne,
  partner,
  partnerOptions,
  doublesCourt,
  scoreOne,
  setScoreOne,
  scoreTwo,
  setScoreTwo,
  opponents,
}: {
  scores: EventScoreRow[];
  playerLabel: (registrationId: string, name: string) => string;
  editingScore: string | null;
  setEditingScore: (id: string | null) => void;
  editScoreOne: string;
  setEditScoreOne: (value: string) => void;
  editScoreTwo: string;
  setEditScoreTwo: (value: string) => void;
  saveEditedScore: (id: string) => Promise<void>;
  busy: boolean;
  scoreEditLocked: boolean;
  isAdmin: boolean;
  currentUserId: string | null;
  setDeletingScore: (score: EventScoreRow) => void;
  clearError: () => void;
  currentUserCanAddScore: boolean;
  event: { starts_at: string; status: string; event_type: string };
  eventHasStarted: boolean;
  formatDateTime: (value: string) => string;
  addScore: (event: FormEvent<HTMLFormElement>) => void;
  isManager: boolean;
  scoreCourt: string;
  setScoreCourt: (value: string) => void;
  setScorePlayerOne: (value: string) => void;
  setPartner: (value: string) => void;
  scoreCourts: EventCourtRow[];
  courtPlayers: EventRosterRow[];
  scorePlayerOne: string;
  partner: string;
  partnerOptions: EventRosterRow[];
  doublesCourt: boolean;
  scoreOne: string;
  setScoreOne: (value: string) => void;
  scoreTwo: string;
  setScoreTwo: (value: string) => void;
  opponents: EventRosterRow[];
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold">Scores</h2>
      {scores.length ? (
        <div className="mt-3 space-y-2">
          {scores.map((score) => (
            <div
              key={score.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <span>
                  {score.player_three_name
                    ? `${playerLabel(score.player_one_registration_id, score.player_one_name)} / ${playerLabel(score.player_two_registration_id, score.player_two_name)}`
                    : playerLabel(score.player_one_registration_id, score.player_one_name)}{' '}
                  <strong>
                    {score.player_one_score} – {score.player_two_score}
                  </strong>{' '}
                  {score.player_three_name
                    ? `${playerLabel(score.player_three_registration_id!, score.player_three_name)}${score.player_four_name ? ` / ${playerLabel(score.player_four_registration_id!, score.player_four_name)}` : ''}`
                    : playerLabel(score.player_two_registration_id, score.player_two_name)}
                </span>
                {editingScore === score.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="text-xs">
                      Your team score
                      <input
                        type="number"
                        min="0"
                        value={editScoreOne}
                        onChange={(event) => setEditScoreOne(event.target.value)}
                        className="mt-1 block h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                      />
                    </label>
                    <label className="text-xs">
                      Opponents score
                      <input
                        type="number"
                        min="0"
                        value={editScoreTwo}
                        onChange={(event) => setEditScoreTwo(event.target.value)}
                        className="mt-1 block h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                      />
                    </label>
                    <Button
                      size="sm"
                      disabled={busy || editScoreOne === '' || editScoreTwo === ''}
                      onClick={() => void saveEditedScore(score.id)}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setEditingScore(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(score.played_at).toLocaleDateString('en-CA')}
                </span>
                {!scoreEditLocked &&
                  (isAdmin || Boolean(currentUserId && score.entered_by === currentUserId)) && (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Edit score"
                        title="Edit score"
                        disabled={busy}
                        onClick={() => {
                          setEditingScore(score.id);
                          setEditScoreOne(String(score.player_one_score));
                          setEditScoreTwo(String(score.player_two_score));
                          clearError();
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Delete score"
                        title="Delete score"
                        disabled={busy}
                        onClick={() => setDeletingScore(score)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </>
                  )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No scores have been entered.</p>
      )}
      {currentUserCanAddScore && event.status === 'published' && !eventHasStarted && (
        <p className="mt-5 rounded-xl border border-border p-4 text-sm text-muted-foreground">
          Score entry will be available when the event starts at {formatDateTime(event.starts_at)}.
        </p>
      )}
      {currentUserCanAddScore &&
        event.status === 'published' &&
        eventHasStarted &&
        !scoreEditLocked && (
          <form onSubmit={addScore} className="mt-5 rounded-xl border border-border p-4">
            <h3 className="font-semibold">Add a score</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {event.event_type === 'social_doubles_ladder'
                ? 'Choose any partner for each score. The other players on the court are your opponents.'
                : isManager
                  ? 'Choose any court and time slot. For a four-player court, select two players on one team; the remaining players are their opponents.'
                  : 'Choose a court and time slot you are assigned to. On a four-player court, select your partner; the other two players become your opponents automatically.'}
            </p>
            <div
              className={`mt-3 grid gap-3 sm:grid-cols-2 ${isManager ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}
            >
              <label className="space-y-1 text-sm">
                Court / sub-session
                <select
                  required
                  value={scoreCourt}
                  onChange={(event) => {
                    setScoreCourt(event.target.value);
                    setScorePlayerOne('');
                    setPartner('');
                  }}
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                >
                  <option value="">Select assignment</option>
                  {scoreCourts.map((court) => (
                    <option
                      key={`${court.court_number}-${court.segment_order}`}
                      value={`${court.court_number}:${court.segment_order}`}
                    >
                      Court {court.court_number} · Sub-session {court.segment_order}
                    </option>
                  ))}
                </select>
              </label>
              {isManager && scoreCourt && (
                <RosterSelect
                  label="Team player"
                  placeholder="Select player"
                  value={scorePlayerOne}
                  options={courtPlayers}
                  onChange={(value) => {
                    setScorePlayerOne(value);
                    setPartner('');
                  }}
                />
              )}
              {doublesCourt && (
                <RosterSelect
                  label="Partner"
                  placeholder="Select partner"
                  value={partner}
                  options={partnerOptions}
                  onChange={setPartner}
                />
              )}
              <label className="space-y-1 text-sm">
                {isManager ? 'Team score' : 'Your team score'}
                <input
                  required
                  type="number"
                  min="0"
                  value={scoreOne}
                  onChange={(event) => setScoreOne(event.target.value)}
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                />
              </label>
              <label className="space-y-1 text-sm">
                {isManager ? 'Opposing team score' : 'Opponents’ score'}
                <input
                  required
                  type="number"
                  min="0"
                  value={scoreTwo}
                  onChange={(event) => setScoreTwo(event.target.value)}
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                />
              </label>
            </div>
            {scoreCourt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Opponents:{' '}
                {doublesCourt && !partner
                  ? 'Select a partner to determine opponents.'
                  : opponents.map((player) => player.full_name).join(' / ') ||
                    'No opponents assigned.'}
              </p>
            )}
            <Button
              className="mt-3"
              disabled={
                busy || !scoreCourts.length || !scoreCourt || (isManager && !scorePlayerOne)
              }
            >
              {busy ? <TennisLoader compact label="Saving" /> : 'Save score'}
            </Button>
            {!scoreCourts.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                You need a court assignment before entering a score.
              </p>
            )}
          </form>
        )}
    </section>
  );
}
