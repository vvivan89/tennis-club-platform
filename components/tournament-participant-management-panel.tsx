import { type FormEvent, type ReactNode } from 'react';
import { Square, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';
import { GenderSelect } from '@/components/gender-select';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { Member, Pair, Participant, Team } from '@/components/tournament-management-types';
import { TournamentEntryGroupingPanel } from '@/components/tournament-entry-grouping-panel';

type ActionResult = { error: { message: string } | null };
export type Props = {
  eventId: string;
  isTeam: boolean;
  leagueTournament: boolean;
  activeCategory: string;
  members: Member[];
  participants: Participant[];
  pairs: Pair[];
  teams: Team[];
  groupCount: number;
  availablePairPlayers: Participant[];
  leagueMemberEligibility: Record<string, boolean>;
  groupOptions: ReactNode;
  busy: boolean;
  unevenTeams: boolean;
  db: ReturnType<typeof createSupabaseBrowserClient>;
  priceCents: number;
  memberId: string;
  participantName: string;
  participantEmail: string;
  participantPhone: string;
  participantGender: string;
  teamName: string;
  teamColor: string;
  teamLogo: File | null;
  captain: string;
  pairCategory: string;
  pairOne: string;
  pairTwo: string;
  pairPlayerOption: (participant: Participant, partnerId: string) => MemberOption;
  profileGenderLabel: (gender: string | null | undefined, category: string) => string | undefined;
  hasOpposingGenderProfile: (gender: string | null | undefined, category: string) => boolean;
  runAction: (action: () => PromiseLike<ActionResult>, success: string) => Promise<boolean>;
  addParticipant: (event: FormEvent) => void;
  addTeam: (event: FormEvent) => void;
  createPair: (event: FormEvent) => void;
  randomizeGroups: () => void;
  saveEntryGroup: (id: string, groupNumber: number | null) => Promise<ActionResult>;
  assignParticipantTeam: (id: string, teamId: string | null) => void;
  setMemberId: (value: string) => void;
  setParticipantName: (value: string) => void;
  setParticipantEmail: (value: string) => void;
  setParticipantPhone: (value: string) => void;
  setParticipantGender: (value: string) => void;
  setTeamName: (value: string) => void;
  setTeamColor: (value: string) => void;
  setTeamLogo: (value: File | null) => void;
  setCaptain: (value: string) => void;
  setPairOne: (value: string) => void;
  setPairTwo: (value: string) => void;
  setPendingRemoveParticipant: (participant: Participant | null) => void;
  setReplacementParticipantId: (id: string) => void;
  setReplaceTarget: (target: { pair: Pair; side: 1 | 2 } | null) => void;
};

export function TournamentParticipantManagementPanel(props: Props) {
  const {
    isTeam,
    leagueTournament,
    activeCategory,
    members,
    participants,
    teams,
    busy,
    priceCents,
    db,
    leagueMemberEligibility,
    memberId,
    participantName,
    participantEmail,
    participantPhone,
    participantGender,
    profileGenderLabel,
    hasOpposingGenderProfile,
    runAction,
    addParticipant,
    assignParticipantTeam,
    setMemberId,
    setParticipantName,
    setParticipantEmail,
    setParticipantPhone,
    setParticipantGender,
    setPendingRemoveParticipant,
  } = props;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-semibold">Participants</h3>
          <form onSubmit={addParticipant} className="space-y-2">
            <label className="block text-sm">
              Existing member
              <SearchableMemberSelect
                value={memberId}
                onChange={setMemberId}
                placeholder={leagueTournament ? 'Search active members' : 'Search members'}
                options={[...members]
                  .sort((a, b) => {
                    const category = isTeam ? 'team' : activeCategory;
                    const aMembershipBlocked =
                      leagueTournament && leagueMemberEligibility[a.id] !== true;
                    const bMembershipBlocked =
                      leagueTournament && leagueMemberEligibility[b.id] !== true;
                    const aGenderBlocked = !isTeam && hasOpposingGenderProfile(a.gender, category);
                    const bGenderBlocked = !isTeam && hasOpposingGenderProfile(b.gender, category);
                    const aRegistered = participants.some(
                      (p) =>
                        p.user_id === a.id && p.category === category && p.status === 'registered',
                    );
                    const bRegistered = participants.some(
                      (p) =>
                        p.user_id === b.id && p.category === category && p.status === 'registered',
                    );
                    return (
                      Number(aMembershipBlocked) - Number(bMembershipBlocked) ||
                      Number(aGenderBlocked) - Number(bGenderBlocked) ||
                      Number(aRegistered) - Number(bRegistered) ||
                      Number(hasOpposingGenderProfile(a.gender, category)) -
                        Number(hasOpposingGenderProfile(b.gender, category)) ||
                      (a.full_name || a.email).localeCompare(b.full_name || b.email)
                    );
                  })
                  .map((m): MemberOption => {
                    const selectedCategory = isTeam ? 'team' : activeCategory;
                    const existingEntries = participants.filter(
                      (p) =>
                        p.user_id === m.id &&
                        p.category === selectedCategory &&
                        p.status === 'registered',
                    );
                    const addedCategories = [
                      ...new Set(
                        existingEntries.map((p) =>
                          p.category === 'team' ? 'team roster' : `${p.category} doubles`,
                        ),
                      ),
                    ].join(', ');
                    const oppositeCategory =
                      selectedCategory === 'men'
                        ? 'women'
                        : selectedCategory === 'women'
                          ? 'men'
                          : null;
                    const oppositeEntry = oppositeCategory
                      ? participants.find(
                          (p) =>
                            p.user_id === m.id &&
                            p.category === oppositeCategory &&
                            p.status === 'registered',
                        )
                      : undefined;
                    const membershipBlocked =
                      leagueTournament && leagueMemberEligibility[m.id] !== true;
                    const genderBlocked =
                      !isTeam && hasOpposingGenderProfile(m.gender, selectedCategory);
                    const blockedReason = existingEntries.length
                      ? `Already added (${addedCategories})`
                      : oppositeEntry
                        ? `Already registered for ${oppositeCategory === 'men' ? "men's" : "women's"} doubles and cannot enter both`
                        : genderBlocked
                          ? `Profile gender does not match ${selectedCategory === 'men' ? "men's" : "women's"} doubles`
                          : membershipBlocked
                            ? 'Active paid membership required'
                            : undefined;
                    const genderLabel = profileGenderLabel(m.gender, selectedCategory);
                    const statusText =
                      [
                        genderLabel,
                        membershipBlocked ? 'Active paid membership required' : undefined,
                        genderBlocked
                          ? `Not eligible for ${selectedCategory === 'men' ? "men's" : "women's"} doubles`
                          : undefined,
                        blockedReason,
                      ]
                        .filter(Boolean)
                        .filter((text, index, all) => all.indexOf(text) === index)
                        .join(' · ') || undefined;
                    return {
                      id: m.id,
                      full_name: m.full_name || m.email,
                      email: m.email,
                      statusText,
                      sortPriority: membershipBlocked
                        ? 3
                        : genderBlocked
                          ? 2
                          : blockedReason
                            ? 1
                            : genderLabel
                              ? 1
                              : 0,
                      available: !blockedReason,
                      unavailableReason: statusText,
                    };
                  })}
              />
            </label>
            {!memberId && !leagueTournament && (
              <>
                <Input
                  placeholder="Full name"
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  required
                />
                <Input
                  type="email"
                  placeholder="Email (private)"
                  value={participantEmail}
                  onChange={(e) => setParticipantEmail(e.target.value)}
                />
                <Input
                  placeholder="Phone (private)"
                  value={participantPhone}
                  onChange={(e) => setParticipantPhone(e.target.value)}
                />
                <GenderSelect
                  value={participantGender}
                  onChange={setParticipantGender}
                  className="block text-sm"
                  selectClassName="block h-10 w-full rounded-md border border-input bg-background px-3"
                />
              </>
            )}
            <Button disabled={busy || (leagueTournament && !memberId)} type="submit">
              Add participant
            </Button>
          </form>
          <div className="space-y-3">
            <h4 className="font-semibold">
              Registered participants (
              {
                participants.filter(
                  (p) => p.status === 'registered' && (isTeam || p.category === activeCategory),
                ).length
              }
              )
            </h4>
            {participants
              .filter((p) => p.status === 'registered' && (isTeam || p.category === activeCategory))
              .map((p) => (
                <div
                  key={p.id}
                  className={`grid gap-2 rounded-md bg-secondary/40 p-2 text-sm ${isTeam ? 'sm:grid-cols-[minmax(0,1fr)_10rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {p.display_name}
                        {(p.captain_requested ||
                          teams.some((team) => team.captain_user_id === p.user_id)) && (
                          <span
                            role="img"
                            aria-label={
                              teams.some((team) => team.captain_user_id === p.user_id)
                                ? 'Confirmed team captain'
                                : 'Captain request pending'
                            }
                            className={`relative inline-flex h-5 w-5 shrink-0 ${teams.some((team) => team.captain_user_id === p.user_id) ? 'text-primary' : 'text-muted-foreground'}`}
                          >
                            <Square aria-hidden="true" className="absolute inset-0 h-5 w-5" />
                            <Star
                              aria-hidden="true"
                              className="absolute inset-[5px] h-[10px] w-[10px]"
                              fill="currentColor"
                            />
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {members.some((member) => member.id === p.user_id)
                          ? 'Member'
                          : 'Non-member'}{' '}
                        · {priceCents > 0 && p.payment_status === 'pending' ? 'Pending' : p.status}
                      </p>
                      {priceCents > 0 && p.payment_status === 'pending' && (
                        <p className="mt-1 text-xs text-warning-foreground dark:text-warning-foreground">
                          Pending payment — registration is awaiting payment confirmation.
                        </p>
                      )}
                    </div>
                  </div>
                  {isTeam && (
                    <select
                      aria-label={`Team for ${p.display_name}`}
                      className="h-9 rounded-md border border-input bg-background px-2"
                      value={p.team_id ?? ''}
                      disabled={!isTeam}
                      onChange={(e) => assignParticipantTeam(p.id, e.target.value || null)}
                    >
                      <option value="">No team</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
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
                      aria-label={`More actions for ${p.display_name}`}
                    >
                      ⋮
                    </summary>
                    <div className="absolute right-0 z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] space-y-2 rounded-md border border-border bg-background p-3 shadow-lg">
                      {!leagueTournament && (
                        <label className="block text-xs">
                          Tournament gender override
                          <select
                            aria-label={`Gender override for ${p.display_name}`}
                            className="mt-1 block h-8 rounded-md border border-input bg-background px-2"
                            value={p.gender_override ?? ''}
                            onChange={(e) =>
                              void runAction(
                                () =>
                                  db
                                    .from('tournament_participants')
                                    .update({ gender_override: e.target.value || null })
                                    .eq('id', p.id),
                                'Gender eligibility override updated.',
                              )
                            }
                          >
                            <option value="">Use profile gender ({p.gender || 'not set'})</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                        </label>
                      )}
                      <label className="block text-xs">
                        Entry payment
                        <select
                          aria-label={`Payment status for ${p.display_name}`}
                          className="mt-1 block h-8 rounded-md border border-input bg-background px-2"
                          value={p.payment_status}
                          onChange={(e) =>
                            void runAction(
                              () =>
                                db
                                  .from('tournament_participants')
                                  .update({ payment_status: e.target.value })
                                  .eq('id', p.id),
                              'Entry payment status updated.',
                            )
                          }
                        >
                          <option value="not_required">Not required</option>
                          <option value="pending">Pending</option>
                          <option value="paid">Paid</option>
                          <option value="refunded">Refunded</option>
                          <option value="failed">Failed</option>
                        </select>
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingRemoveParticipant(p)}
                      >
                        Remove player
                      </Button>
                    </div>
                  </details>
                </div>
              ))}
          </div>
        </div>
        <TournamentEntryGroupingPanel {...props} />
      </div>
    </div>
  );
}
