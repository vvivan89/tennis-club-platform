'use client';

import { Input } from '@/components/ui/input';
import { PaymentOptionsButton, type PaymentOption } from '@/components/payment-options-button';
import { TennisSkillLevelSelect } from '@/components/tennis-skill-level-select';
import { GenderSelect } from '@/components/gender-select';
import type { InteracPaymentNotice } from '@/components/interac-payment-instructions-dialog';
import type {
  PairPaymentStatus,
  OwnTournamentEntry,
  Pair,
  Team,
} from '@/components/tournament-public-view-types';
import type { TournamentConfig } from '@/lib/tournament-config';
import { categoryLabel, formatMoney } from '@/components/tournament-public-view-format';

type Provider = 'stripe' | 'interac';
type PairWithdrawal = { participantId: string; partnerParticipantId: string };

export function TournamentOwnRegistrationList({
  currentUserId,
  currentUserName,
  currentUserEmail,
  currentUserPhone,
  currentUserGender,
  currentUserSkillLevel,
  isEventGuest,
  ownEntries,
  teams,
  canRequestCaptain,
  captainRequestBusy,
  requestCaptain,
  pairs,
  pairPaymentStatuses,
  registrationClosesAt,
  startsAt,
  interacRequests,
  interacEnabled,
  paymentBusy,
  partnerConfirmationBusy,
  confirmPartnerParticipation,
  paymentBusyKey,
  paymentActionKey: tournamentPaymentActionKey,
  startTournamentPayment,
  setInteracNotice,
  setOwnEditTarget,
  setOwnEditName,
  setOwnEditPhone,
  setOwnEditGender,
  setOwnEditSkill,
  ownEditTarget,
  ownEditName,
  ownEditPhone,
  ownEditGender,
  ownEditSkill,
  ownEditBusy,
  saveOwnEventDetails,
  setPartnerEditTarget,
  setPartnerEditName,
  setPartnerEditEmail,
  setPartnerEditPhone,
  setPartnerEditGender,
  setPartnerEditSkill,
  partnerEditTarget,
  partnerEditName,
  partnerEditEmail,
  partnerEditPhone,
  partnerEditGender,
  partnerEditSkill,
  partnerEditBusy,
  savePartnerChange,
  switchToSingle,
  format,
  config,
  leagueTournament,
  leagueWithdrawBusy,
  setRegistrationError,
  setLeagueWithdrawTarget,
  setLeagueWithdrawError,
  setWithdrawError,
  setWithdrawTarget,
}: {
  currentUserId: string | null;
  currentUserName: string;
  currentUserEmail: string | null;
  currentUserPhone: string;
  currentUserGender: string | null;
  currentUserSkillLevel: string | null;
  isEventGuest: boolean;
  ownEntries: OwnTournamentEntry[];
  teams: Team[];
  canRequestCaptain: boolean;
  captainRequestBusy: boolean;
  requestCaptain: (participantId: string) => Promise<void>;
  pairs: Pair[];
  pairPaymentStatuses: PairPaymentStatus[];
  registrationClosesAt: string | null;
  startsAt: string;
  interacRequests: Record<string, InteracPaymentNotice>;
  interacEnabled: boolean;
  paymentBusy: boolean;
  partnerConfirmationBusy: boolean;
  confirmPartnerParticipation: (participantId?: string) => void;
  paymentBusyKey: string | null;
  paymentActionKey: (ids: string[], provider?: Provider) => string;
  startTournamentPayment: (ids?: string[], provider?: Provider) => Promise<void>;
  setInteracNotice: (notice: InteracPaymentNotice | null) => void;
  setOwnEditTarget: (id: string | null) => void;
  setOwnEditName: (value: string) => void;
  setOwnEditPhone: (value: string) => void;
  setOwnEditGender: (value: string) => void;
  setOwnEditSkill: (value: string) => void;
  ownEditTarget: string | null;
  ownEditName: string;
  ownEditPhone: string;
  ownEditGender: string;
  ownEditSkill: string;
  ownEditBusy: boolean;
  saveOwnEventDetails: (id: string) => void;
  setPartnerEditTarget: (id: string | null) => void;
  setPartnerEditName: (value: string) => void;
  setPartnerEditEmail: (value: string) => void;
  setPartnerEditPhone: (value: string) => void;
  setPartnerEditGender: (value: string) => void;
  setPartnerEditSkill: (value: string) => void;
  partnerEditTarget: string | null;
  partnerEditName: string;
  partnerEditEmail: string;
  partnerEditPhone: string;
  partnerEditGender: string;
  partnerEditSkill: string;
  partnerEditBusy: boolean;
  savePartnerChange: (id: string) => void;
  switchToSingle: (id: string) => void;
  format: string | null;
  config: TournamentConfig | null;
  leagueTournament: boolean;
  leagueWithdrawBusy: boolean;
  setRegistrationError: (message: string) => void;
  setLeagueWithdrawTarget: (target: PairWithdrawal | null) => void;
  setLeagueWithdrawError: (message: string) => void;
  setWithdrawError: (message: string) => void;
  setWithdrawTarget: (id: string | null) => void;
}) {
  if (!currentUserId || ownEntries.length === 0) return null;
  return (
    <>
      {currentUserId && ownEntries.length > 0 && (
        <div className="mt-3 space-y-3" aria-label="Your tournament registrations">
          {ownEntries.map((entry) => {
            const entryPair = pairs.find(
              (pair) =>
                pair.status !== 'withdrawn' &&
                pair.category === entry.category &&
                (pair.player_one_id === entry.id || pair.player_two_id === entry.id),
            );
            const cutoffOpen = Date.now() < new Date(registrationClosesAt || startsAt).getTime();
            const paid = entry.payment_status === 'paid' || entry.payment_status === 'not_required';
            const pairPayment = entryPair
              ? pairPaymentStatuses.find((status) => status.pair_id === entryPair.id)
              : undefined;
            const teamFullyPaid =
              !!pairPayment &&
              ['paid', 'not_required'].includes(pairPayment.player_one_payment_status) &&
              ['paid', 'not_required'].includes(pairPayment.player_two_payment_status);
            const eitherPartnerPaid =
              !!pairPayment &&
              ['paid', 'not_required'].some((status) =>
                [
                  pairPayment.player_one_payment_status,
                  pairPayment.player_two_payment_status,
                ].includes(status),
              );
            const paymentStatus =
              entry.payment_status === 'paid'
                ? 'Paid'
                : entry.payment_status === 'not_required'
                  ? 'No payment required'
                  : entry.payment_status === 'refunded'
                    ? 'Refunded'
                    : entry.payment_status === 'failed'
                      ? 'Payment failed'
                      : 'Payment pending';
            const partnerPending = entry.partner_confirmation_status === 'pending';
            const selfInteracKey = tournamentPaymentActionKey([entry.id], 'interac');
            const selfInteracRequest = interacRequests[selfInteracKey];
            const teamParticipantIds = entryPair
              ? [entryPair.player_one_id, entryPair.player_two_id]
              : [];
            const teamInteracKey = teamParticipantIds.length
              ? tournamentPaymentActionKey(teamParticipantIds, 'interac')
              : '';
            const teamInteracRequest = teamInteracKey ? interacRequests[teamInteracKey] : undefined;
            const teamInteracAmount = entry.amount_cents * 2;
            const pendingInteracRequest = selfInteracRequest || teamInteracRequest;
            const canPaySelf =
              entry.confirmation_status === 'confirmed' &&
              !partnerPending &&
              !paid &&
              entry.amount_cents > 0;
            const canPayTeam =
              !!entryPair &&
              !partnerPending &&
              entry.confirmation_status === 'confirmed' &&
              !!pairPayment &&
              !teamFullyPaid &&
              !eitherPartnerPaid &&
              entry.amount_cents > 0;
            const paymentOptions: PaymentOption[] = [];
            if (canPaySelf) {
              paymentOptions.push({
                label: `For myself by card · ${formatMoney(entry.amount_cents)}`,
                onSelect: () => void startTournamentPayment([entry.id]),
                loading: paymentBusyKey === tournamentPaymentActionKey([entry.id]),
                loadingLabel: 'Opening payment',
              });
            }
            if (currentUserId && interacEnabled && canPaySelf && !teamInteracRequest) {
              paymentOptions.push({
                label: selfInteracRequest
                  ? `View Interac instructions · ${selfInteracRequest.amount}`
                  : `For myself by Interac · ${formatMoney(entry.amount_cents)}`,
                onSelect: () =>
                  selfInteracRequest
                    ? setInteracNotice(selfInteracRequest)
                    : void startTournamentPayment([entry.id], 'interac'),
              });
            }
            if (canPayTeam && entryPair) {
              paymentOptions.push({
                label: `For both by card · ${formatMoney(teamInteracAmount)}`,
                onSelect: () =>
                  void startTournamentPayment([entryPair.player_one_id, entryPair.player_two_id]),
                loading:
                  paymentBusyKey ===
                  tournamentPaymentActionKey([entryPair.player_one_id, entryPair.player_two_id]),
                loadingLabel: 'Opening payment',
              });
            }
            if (
              currentUserId &&
              interacEnabled &&
              canPayTeam &&
              entryPair &&
              (!selfInteracRequest || !!teamInteracRequest)
            ) {
              paymentOptions.push({
                label: teamInteracRequest
                  ? `View Interac instructions · ${teamInteracRequest.amount}`
                  : `For both by Interac · ${formatMoney(teamInteracAmount)}`,
                onSelect: () =>
                  teamInteracRequest
                    ? setInteracNotice(teamInteracRequest)
                    : void startTournamentPayment(teamParticipantIds, 'interac'),
              });
            }
            return (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{categoryLabel(entry.category)}</p>
                  <p className="mt-1 text-sm">{entry.display_name || currentUserName}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.email || currentUserEmail} ·{' '}
                    {entry.phone || currentUserPhone || 'Phone not provided'} ·{' '}
                    {(entry.gender || currentUserGender || 'Gender not specified').replace(
                      /^./,
                      (character) => character.toUpperCase(),
                    )}{' '}
                    · Rating {entry.tennis_skill_level ?? currentUserSkillLevel ?? 'not specified'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {entry.confirmation_status === 'pending'
                      ? 'Awaiting your confirmation'
                      : pendingInteracRequest
                        ? `Interac payment requested (${pendingInteracRequest.amount}); awaiting club confirmation`
                        : paymentStatus}
                    {entry.partner_id
                      ? ` · Partner: ${entry.partner_name || 'Partner'} · ${partnerPending ? 'Awaiting partner confirmation' : 'Partner confirmed'}${entryPair ? ` · Team payment: ${teamFullyPaid ? 'Paid' : 'Pending'}` : ''}`
                      : ''}
                  </p>
                  {entry.partner_id && (
                    <p className="text-xs text-muted-foreground">
                      Partner details: {entry.partner_name || 'Name not provided'} ·{' '}
                      {entry.partner_email || 'Email not provided'} ·{' '}
                      {entry.partner_phone || 'Phone not provided'} ·{' '}
                      {entry.partner_gender || 'Gender not specified'} · Rating{' '}
                      {entry.partner_skill_level ?? 'not specified'}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {isEventGuest && cutoffOpen && (
                    <button
                      type="button"
                      className="h-9 rounded-md border border-border px-3 text-sm"
                      onClick={() => {
                        setOwnEditTarget(entry.id);
                        setOwnEditName(entry.display_name || '');
                        setOwnEditPhone(entry.phone || '');
                        setOwnEditGender(entry.gender || '');
                        setOwnEditSkill(entry.tennis_skill_level?.toString() || '');
                      }}
                    >
                      Edit my details
                    </button>
                  )}
                  {paymentOptions.length > 0 && (
                    <PaymentOptionsButton
                      options={paymentOptions}
                      disabled={paymentBusy}
                      className="h-9 border border-primary px-3 text-sm"
                    />
                  )}
                  {format === 'team' && canRequestCaptain && (
                    <button
                      type="button"
                      disabled={
                        captainRequestBusy ||
                        !!entry.captain_requested ||
                        teams.some(
                          (team) =>
                            team.id === entry.team_id && team.captain_user_id === currentUserId,
                        )
                      }
                      onClick={() => void requestCaptain(entry.id)}
                      className="h-9 rounded-md border border-border px-3 text-sm"
                    >
                      {teams.some(
                        (team) =>
                          team.id === entry.team_id && team.captain_user_id === currentUserId,
                      )
                        ? 'Captain confirmed'
                        : entry.captain_requested
                          ? 'Captain request sent'
                          : 'I want to be a captain'}
                    </button>
                  )}
                  {entry.confirmation_status === 'pending' && entry.partner_id && (
                    <button
                      type="button"
                      disabled={partnerConfirmationBusy}
                      onClick={() => confirmPartnerParticipation(entry.id)}
                      className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {partnerConfirmationBusy ? 'Confirming…' : 'Confirm participation'}
                    </button>
                  )}
                  {cutoffOpen &&
                    entry.partner_confirmation_status === 'pending' &&
                    !entry.partner_is_league_team && (
                      <>
                        <button
                          type="button"
                          className="h-9 rounded-md border border-border px-3 text-sm"
                          onClick={() => {
                            setPartnerEditTarget(entry.id);
                            setPartnerEditName(entry.partner_name || '');
                            setPartnerEditEmail(entry.partner_email || '');
                            setPartnerEditPhone(entry.partner_phone || '');
                            setPartnerEditGender(entry.partner_gender || '');
                            setPartnerEditSkill(entry.partner_skill_level?.toString() || '');
                          }}
                        >
                          Change partner
                        </button>
                        {format === 'doubles' && config?.registration_mode !== 'doubles' && (
                          <button
                            type="button"
                            disabled={partnerEditBusy}
                            onClick={() => void switchToSingle(entry.id)}
                            className="h-9 rounded-md border border-border px-3 text-sm"
                          >
                            Register as a single
                          </button>
                        )}
                      </>
                    )}
                  {cutoffOpen && (
                    <button
                      type="button"
                      disabled={paymentBusy || leagueWithdrawBusy}
                      onClick={async () => {
                        if (leagueTournament && entry.partner_is_league_team) {
                          if (!entryPair) {
                            setRegistrationError(
                              'The League team pair could not be found. Contact the organizer before withdrawing.',
                            );
                            return;
                          }
                          setLeagueWithdrawTarget({
                            participantId: entry.id,
                            partnerParticipantId:
                              entryPair.player_one_id === entry.id
                                ? entryPair.player_two_id
                                : entryPair.player_one_id,
                          });
                          setLeagueWithdrawError('');
                          return;
                        }
                        setWithdrawError('');
                        setWithdrawTarget(entry.id);
                      }}
                      className="h-9 rounded-md border border-destructive/50 px-3 text-sm text-destructive"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
                {ownEditTarget === entry.id && (
                  <form
                    className="w-full grid gap-2 rounded-md bg-secondary/30 p-3 sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveOwnEventDetails(entry.id);
                    }}
                  >
                    <label className="text-sm">
                      Your name
                      <Input
                        value={ownEditName}
                        onChange={(event) => setOwnEditName(event.target.value)}
                        required
                        maxLength={160}
                      />
                    </label>
                    <label className="text-sm">
                      Verified email
                      <Input type="email" value={entry.email || currentUserEmail || ''} readOnly />
                    </label>
                    <label className="text-sm">
                      Phone
                      <Input
                        value={ownEditPhone}
                        onChange={(event) => setOwnEditPhone(event.target.value)}
                        maxLength={40}
                      />
                    </label>
                    <TennisSkillLevelSelect
                      label="Tennis skill rating"
                      value={ownEditSkill}
                      onChange={setOwnEditSkill}
                      className="text-sm"
                      selectClassName="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                    />
                    <GenderSelect value={ownEditGender} onChange={setOwnEditGender} />
                    <p className="self-end text-xs text-muted-foreground">
                      Your gender affects eligibility for gender-specific categories.
                    </p>
                    <div className="flex gap-2 sm:col-span-2">
                      <button
                        type="submit"
                        disabled={ownEditBusy}
                        className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground"
                      >
                        {ownEditBusy ? 'Saving…' : 'Save details'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOwnEditTarget(null)}
                        className="h-9 rounded-md border border-border px-3 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                {partnerEditTarget === entry.id && (
                  <form
                    className="w-full grid gap-2 rounded-md bg-secondary/30 p-3 sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void savePartnerChange(entry.id);
                    }}
                  >
                    <label className="text-sm">
                      Partner name
                      <Input
                        value={partnerEditName}
                        onChange={(event) => setPartnerEditName(event.target.value)}
                        required
                      />
                    </label>
                    <label className="text-sm">
                      Partner email
                      <Input
                        type="email"
                        value={partnerEditEmail}
                        onChange={(event) => setPartnerEditEmail(event.target.value)}
                        required
                      />
                    </label>
                    <label className="text-sm">
                      Phone
                      <Input
                        value={partnerEditPhone}
                        onChange={(event) => setPartnerEditPhone(event.target.value)}
                      />
                    </label>
                    <TennisSkillLevelSelect
                      label="Partner tennis skill level"
                      value={partnerEditSkill}
                      onChange={setPartnerEditSkill}
                      className="text-sm"
                      selectClassName="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                    />
                    <GenderSelect
                      label="Partner gender (for doubles events)"
                      value={partnerEditGender}
                      onChange={setPartnerEditGender}
                    />
                    <div className="flex gap-2 sm:col-span-2">
                      <button
                        type="submit"
                        disabled={partnerEditBusy}
                        className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground"
                      >
                        Save and invite
                      </button>
                      <button
                        type="button"
                        onClick={() => setPartnerEditTarget(null)}
                        className="h-9 rounded-md border border-border px-3 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
