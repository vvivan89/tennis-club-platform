import type { Props as MatchManagementProps } from '@/components/tournament-match-management-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TennisLoader } from '@/components/tennis-loader';
import { SearchableMemberSelect } from '@/components/searchable-member-select';

type Props = Pick<
  MatchManagementProps,
  | 'isTeam'
  | 'captainMode'
  | 'busy'
  | 'matches'
  | 'matchCategory'
  | 'matchPhase'
  | 'generateSchedule'
  | 'randomizeKnockoutDraw'
  | 'availableMatchPhases'
  | 'setMatchPhase'
  | 'isRoundRobinPhase'
  | 'matchGrouping'
  | 'setMatchGrouping'
  | 'bracketNeedsRedraw'
  | 'knockoutBracketHasResults'
  | 'createMatch'
  | 'matchOne'
  | 'setMatchOne'
  | 'newMatchSideOptions'
  | 'matchTwo'
  | 'setMatchTwo'
  | 'matchTime'
  | 'setMatchTime'
  | 'matchCourt'
  | 'setMatchCourt'
  | 'courtCount'
> & { singleGroup: boolean };

export function TournamentMatchScheduleControls(props: Props) {
  const {
    isTeam,
    captainMode = false,
    busy,
    matches,
    matchCategory,
    matchPhase,
    generateSchedule,
    randomizeKnockoutDraw,
    availableMatchPhases,
    setMatchPhase,
    isRoundRobinPhase,
    matchGrouping,
    setMatchGrouping,
    bracketNeedsRedraw,
    knockoutBracketHasResults,
    createMatch,
    matchOne,
    setMatchOne,
    newMatchSideOptions,
    matchTwo,
    setMatchTwo,
    matchTime,
    setMatchTime,
    matchCourt,
    setMatchCourt,
    courtCount,
    singleGroup,
  } = props;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Matches, scheduling and results</h3>
        {!captainMode && (
          <div className="flex flex-wrap items-center gap-2">
            {matchPhase === (isTeam ? 'team_round_robin' : 'round_robin') && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  matches.some(
                    (m) =>
                      m.category === matchCategory &&
                      m.phase === matchPhase &&
                      ((m.score_sets?.length ?? 0) > 0 ||
                        m.winner_side != null ||
                        m.status === 'completed'),
                  )
                }
                onClick={() => void generateSchedule()}
              >
                {busy ? <TennisLoader label="Scheduling" compact /> : 'Suggest schedule'}
              </Button>
            )}
            {(matchPhase === (isTeam ? 'team_knockout' : 'final_knockout') ||
              matchPhase === 'preliminary_knockout') && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  matches.some(
                    (m) =>
                      m.category === matchCategory &&
                      m.phase.includes('knockout') &&
                      ((m.score_sets?.length ?? 0) > 0 ||
                        m.winner_side != null ||
                        m.status === 'completed'),
                  )
                }
                onClick={() => void randomizeKnockoutDraw()}
              >
                {busy ? <TennisLoader label="Creating draw" compact /> : 'Create draw'}
              </Button>
            )}
            {(matchPhase === (isTeam ? 'team_round_robin' : 'round_robin') ||
              matchPhase === (isTeam ? 'team_knockout' : 'final_knockout') ||
              matchPhase === 'preliminary_knockout') &&
              availableMatchPhases.length > 1 && (
                <span aria-hidden="true" className="mx-1 h-7 border-l border-border" />
              )}
            {availableMatchPhases.length > 1 && (
              <div
                className="inline-flex rounded-md border border-border p-1"
                role="group"
                aria-label="Match schedule phase"
              >
                {availableMatchPhases.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={matchPhase === key}
                    onClick={() => setMatchPhase(key)}
                    className={`rounded px-3 py-2 text-sm ${matchPhase === key ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
                  >
                    {label.replace('Team ', '')}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {!captainMode && (
        <p className="text-sm text-muted-foreground">
          Suggested start times are between 8:00 AM and 9:00 PM, with configurable match length and
          breaks. Every match remains editable or deletable by administrators.
        </p>
      )}
      {!captainMode && isRoundRobinPhase && !singleGroup && (
        <div
          className="inline-flex rounded-md border border-border p-1"
          role="group"
          aria-label="Group round-robin matches by"
        >
          {(['group', 'round'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={matchGrouping === mode}
              onClick={() => setMatchGrouping(mode)}
              className={`rounded px-3 py-2 text-sm ${matchGrouping === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
            >
              By {mode}
            </button>
          ))}
        </div>
      )}
      {!captainMode && bracketNeedsRedraw && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          The participant count has changed since this knockout bracket was generated.{' '}
          {knockoutBracketHasResults
            ? 'Results exist, so the bracket cannot be regenerated; edit it manually.'
            : 'Use Create draw to regenerate the bracket and schedule, or edit the bracket manually.'}
        </p>
      )}
      {!captainMode && (
        <form onSubmit={createMatch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            Side one
            <SearchableMemberSelect
              value={matchOne}
              onChange={setMatchOne}
              placeholder="Choose side one"
              options={newMatchSideOptions(1)}
            />
          </label>
          <label className="text-sm">
            Side two
            <SearchableMemberSelect
              value={matchTwo}
              onChange={setMatchTwo}
              placeholder="Choose side two"
              options={newMatchSideOptions(2)}
            />
          </label>
          <label className="text-sm">
            Date and time (optional)
            <Input
              type="datetime-local"
              value={matchTime}
              onChange={(e) => setMatchTime(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Court (optional)
            <select
              className="block h-10 w-full rounded-md border border-input bg-background px-3"
              value={matchCourt}
              onChange={(e) => setMatchCourt(e.target.value)}
            >
              <option value="">Unassigned</option>
              {Array.from({ length: Math.max(1, courtCount) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Court {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button disabled={busy} type="submit">
              Add match
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
