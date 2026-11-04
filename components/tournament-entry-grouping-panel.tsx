import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';
import { GroupAssignmentSelect } from '@/components/group-assignment-select';
import type { Props } from '@/components/tournament-participant-management-panel';

export function TournamentEntryGroupingPanel(props: Props) {
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamColor, setEditTeamColor] = useState('');
  const [editTeamLogo, setEditTeamLogo] = useState<File | null>(null);
  const [removeTeamLogo, setRemoveTeamLogo] = useState(false);
  const [pendingRemoveTeam, setPendingRemoveTeam] = useState<Props['teams'][number] | null>(null);
  const {
    eventId,
    isTeam,
    leagueTournament,
    activeCategory,
    participants,
    pairs,
    teams,
    groupCount,
    availablePairPlayers,
    groupOptions,
    busy,
    unevenTeams,
    db,
    teamName,
    teamColor,
    teamLogo,
    captain,
    pairCategory,
    pairOne,
    pairTwo,
    pairPlayerOption,
    runAction,
    addTeam,
    createPair,
    randomizeGroups,
    saveEntryGroup,
    setTeamName,
    setTeamColor,
    setTeamLogo,
    setCaptain,
    setPairOne,
    setPairTwo,
    setReplacementParticipantId,
    setReplaceTarget,
  } = props;
  return (
    <>
      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{isTeam ? 'Teams and captains' : 'Doubles pairs'}</h3>
          {!leagueTournament && groupCount > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                busy ||
                !(isTeam
                  ? teams.length
                  : pairs.some(
                      (pair) => pair.category === activeCategory && pair.status !== 'withdrawn',
                    ))
              }
              onClick={() => void randomizeGroups()}
            >
              Random group draw
            </Button>
          )}
        </div>
        {isTeam && unevenTeams && (
          <p
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            Team rosters are uneven by more than one player. Try to distribute players evenly; a
            difference of one is acceptable.
          </p>
        )}
        {isTeam ? (
          <>
            <form onSubmit={addTeam} className="space-y-2">
              <Input
                placeholder="Team name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
              <Input
                placeholder="Team colour (e.g. all blacks)"
                value={teamColor}
                onChange={(e) => setTeamColor(e.target.value)}
              />
              <label className="block text-sm">
                Team logo (optional)
                <Input
                  className="mt-1"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => setTeamLogo(e.target.files?.[0] ?? null)}
                />
                {teamLogo && (
                  <span className="mt-1 block text-xs text-muted-foreground">{teamLogo.name}</span>
                )}
              </label>
              <label className="block text-sm">
                Captain
                <SearchableMemberSelect
                  value={captain}
                  onChange={setCaptain}
                  placeholder="Search captains"
                  options={participants
                    .filter(
                      (participant) => participant.status === 'registered' && participant.user_id,
                    )
                    .map((participant): MemberOption => ({
                      id: participant.user_id!,
                      full_name: participant.display_name,
                      email: participant.email ?? '',
                      statusText: 'Registered player',
                    }))}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Create team
              </Button>
            </form>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Teams</p>
              </div>
              {teams.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-pctc-team-id', t.id)}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    {t.logo_url && (
                      <Image
                        src={t.logo_url}
                        alt={t.name}
                        width={36}
                        height={36}
                        unoptimized
                        className="h-9 w-9 rounded object-contain"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.color || 'No colour set'} ·{' '}
                        {
                          participants.filter(
                            (p) =>
                              p.team_id === t.id &&
                              p.category === 'team' &&
                              p.status === 'registered',
                          ).length
                        }{' '}
                        players
                      </p>
                    </div>
                    {groupCount > 1 && (
                      <GroupAssignmentSelect
                        ariaLabel={`Group for ${t.name}`}
                        value={t.group_number}
                        options={groupOptions}
                        onChange={(group) =>
                          void runAction(
                            () => saveEntryGroup(t.id, group ? Number(group) : null),
                            'Group assignment updated.',
                          )
                        }
                      />
                    )}
                  </div>
                  <label className="mt-3 block text-xs text-muted-foreground">
                    Captain
                    <select
                      aria-label={`Captain for ${t.name}`}
                      className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-foreground"
                      value={t.captain_user_id ?? ''}
                      onChange={(event) =>
                        void runAction(
                          () =>
                            db
                              .from('tournament_teams')
                              .update({ captain_user_id: event.target.value || null })
                              .eq('id', t.id),
                          'Team captain updated.',
                        )
                      }
                    >
                      <option value="">No captain</option>
                      {participants
                        .filter(
                          (participant) =>
                            participant.team_id === t.id &&
                            participant.status === 'registered' &&
                            participant.user_id,
                        )
                        .map((participant) => (
                          <option key={participant.user_id} value={participant.user_id!}>
                            {participant.display_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {editingTeamId === t.id ? (
                    <form
                      className="mt-3 space-y-2 rounded-md bg-secondary/30 p-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void runAction(async () => {
                          if (editTeamLogo && !editTeamLogo.type.startsWith('image/'))
                            return {
                              error: { message: 'Choose an image file for the team logo.' },
                            };
                          if (editTeamLogo && editTeamLogo.size > 3 * 1024 * 1024)
                            return { error: { message: 'Team logo must be 3 MB or smaller.' } };
                          let logoUrl = removeTeamLogo ? null : t.logo_url;
                          if (editTeamLogo) {
                            const extension =
                              editTeamLogo.name
                                .split('.')
                                .pop()
                                ?.toLowerCase()
                                .replace(/[^a-z0-9]/g, '') || 'png';
                            const path = `${eventId}/team-logo-${Date.now()}.${extension}`;
                            const { error } = await db.storage
                              .from('tournament-team-logos')
                              .upload(path, editTeamLogo, { contentType: editTeamLogo.type });
                            if (error) return { error };
                            logoUrl = db.storage.from('tournament-team-logos').getPublicUrl(path)
                              .data.publicUrl;
                          }
                          return db
                            .from('tournament_teams')
                            .update({
                              name: editTeamName.trim(),
                              color: editTeamColor.trim(),
                              logo_url: logoUrl,
                            })
                            .eq('id', t.id);
                        }, 'Team updated.').then((saved) => {
                          if (saved) {
                            setEditingTeamId(null);
                            setEditTeamLogo(null);
                            setRemoveTeamLogo(false);
                          }
                        });
                      }}
                    >
                      <Input
                        aria-label={`Team name for ${t.name}`}
                        value={editTeamName}
                        onChange={(event) => setEditTeamName(event.target.value)}
                        required
                      />
                      <Input
                        aria-label={`Team color for ${t.name}`}
                        value={editTeamColor}
                        onChange={(event) => setEditTeamColor(event.target.value)}
                        placeholder="Team colour"
                      />
                      <label className="block text-xs">
                        Upload replacement logo
                        <Input
                          className="mt-1"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(event) => {
                            setEditTeamLogo(event.target.files?.[0] ?? null);
                            setRemoveTeamLogo(false);
                          }}
                        />
                      </label>
                      {t.logo_url && !removeTeamLogo && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditTeamLogo(null);
                            setRemoveTeamLogo(true);
                          }}
                        >
                          Remove current logo
                        </Button>
                      )}
                      {removeTeamLogo && (
                        <p className="text-xs text-muted-foreground">Logo will be removed.</p>
                      )}
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={busy}>
                          Save team
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingTeamId(null);
                            setEditTeamLogo(null);
                            setRemoveTeamLogo(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingTeamId(t.id);
                          setEditTeamName(t.name);
                          setEditTeamColor(t.color || '');
                          setEditTeamLogo(null);
                          setRemoveTeamLogo(false);
                        }}
                      >
                        Edit team
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setPendingRemoveTeam(t)}
                      >
                        Remove team
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {activeCategory === 'mixed' &&
              (() => {
                const registered = participants.filter(
                  (p) => p.category === 'mixed' && p.status === 'registered',
                );
                const men = registered.filter(
                  (p) => (p.gender_override || p.gender) === 'male',
                ).length;
                const women = registered.filter(
                  (p) => (p.gender_override || p.gender) === 'female',
                ).length;
                return men !== women ? (
                  <p
                    role="status"
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  >
                    Mixed doubles registrations are currently unbalanced: {women} women and {men}{' '}
                    men. Players with unspecified gender are not included in this count.
                  </p>
                ) : null;
              })()}
            <form onSubmit={createPair} className="space-y-2">
              <label className="block text-sm">
                Player one
                <SearchableMemberSelect
                  value={pairOne}
                  onChange={setPairOne}
                  placeholder="Choose player"
                  options={availablePairPlayers
                    .filter((p) => p.category === pairCategory)
                    .map((p) => pairPlayerOption(p, pairTwo))}
                />
              </label>
              <label className="block text-sm">
                Player two
                <SearchableMemberSelect
                  value={pairTwo}
                  onChange={setPairTwo}
                  placeholder="Choose partner"
                  options={availablePairPlayers
                    .filter((p) => p.category === pairCategory)
                    .map((p) => pairPlayerOption(p, pairOne))}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Create pair
              </Button>
            </form>
            <div className="space-y-2">
              {pairs
                .filter((p) => p.status !== 'withdrawn' && p.category === activeCategory)
                .map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/x-pctc-pair-id', p.id)}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm"
                  >
                    <span className="min-w-0 flex-1 font-medium">
                      {p.player_one_name} + {p.player_two_name}
                    </span>
                    {participants.some(
                      (participant) =>
                        [p.player_one_id, p.player_two_id].includes(participant.id) &&
                        participant.confirmation_status === 'pending',
                    ) && (
                      <>
                        <span className="text-xs text-muted-foreground">Awaiting confirmation</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void runAction(async () => {
                              const response = await fetch('/api/events/partner-invitations', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  participantIds: [p.player_one_id, p.player_two_id],
                                }),
                              });
                              const result = await response.json().catch(() => ({}));
                              return response.ok
                                ? { error: null }
                                : {
                                    error: {
                                      message:
                                        result.error ||
                                        'Could not resend confirmation invitations.',
                                    },
                                  };
                            }, 'Confirmation invitations sent.')
                          }
                        >
                          Resend confirmation
                        </Button>
                      </>
                    )}
                    {!leagueTournament && groupCount > 1 && (
                      <GroupAssignmentSelect
                        ariaLabel={`Group for ${p.player_one_name} and ${p.player_two_name}`}
                        value={p.group_number}
                        options={groupOptions}
                        onChange={(group) =>
                          void runAction(
                            () => saveEntryGroup(p.id, group ? Number(group) : null),
                            'Group assignment updated.',
                          )
                        }
                      />
                    )}
                    <details
                      className="relative shrink-0"
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                          e.currentTarget.open = false;
                      }}
                      data-tournament-menu="true"
                    >
                      <summary
                        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded border border-border text-lg leading-none"
                        aria-label={`Actions for ${p.player_one_name} and ${p.player_two_name}`}
                      >
                        ⋮
                      </summary>
                      <div className="absolute right-0 z-50 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-md border border-border bg-background p-2 shadow-lg">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setReplacementParticipantId('');
                            setReplaceTarget({ pair: p, side: 1 });
                          }}
                        >
                          Replace {p.player_one_name}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setReplacementParticipantId('');
                            setReplaceTarget({ pair: p, side: 2 });
                          }}
                        >
                          Replace {p.player_two_name}
                        </Button>
                      </div>
                    </details>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!pendingRemoveTeam}
        title="Remove team?"
        description={
          pendingRemoveTeam
            ? `Remove ${pendingRemoveTeam.name}? Its players will stay registered and become unassigned.`
            : ''
        }
        confirmLabel="Remove team"
        destructive
        busy={busy}
        onCancel={() => setPendingRemoveTeam(null)}
        onConfirm={() => {
          if (!pendingRemoveTeam) return;
          void runAction(
            () => db.from('tournament_teams').delete().eq('id', pendingRemoveTeam.id),
            'Team removed. Its players are now unassigned.',
          ).then((removed) => removed && setPendingRemoveTeam(null));
        }}
      />
    </>
  );
}
