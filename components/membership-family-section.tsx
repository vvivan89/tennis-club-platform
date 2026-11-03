'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PaymentOptionsButton } from '@/components/payment-options-button';
import { SearchableMemberSelect } from '@/components/searchable-member-select';
import { TennisLoader } from '@/components/tennis-loader';
import type {
  Family,
  FamilyEntry,
  FamilyMember,
  MembershipSettings,
  Payment,
  Person,
  Profile,
} from '@/app/member/membership-types';

type FamilyAction = 'invite' | 'confirm' | 'remove';
type FamilyActionData = { userId?: string; invitationId?: string; familyId?: string };

export function MembershipFamilySection({
  currentFamily,
  activeMembershipStatus,
  displayedFamilyStatus,
  currentMembers,
  me,
  currentWaiver,
  settings,
  familyPaid,
  familyWaiversComplete,
  busy,
  checkoutLoading,
  interacEnabled,
  interacPendingPayment,
  canProceedWithWaiver,
  startCheckout,
  viewInteracInstructions,
  act,
  selected,
  setSelected,
  eligiblePeople,
  incoming,
  money,
  date,
}: {
  currentFamily: Family | null | undefined;
  activeMembershipStatus: string | undefined;
  displayedFamilyStatus: string | undefined;
  currentMembers: FamilyMember[];
  me: Profile | null;
  currentWaiver: { version: number; title: string; body_html: string } | null;
  settings: MembershipSettings | null;
  familyPaid: boolean;
  familyWaiversComplete: boolean;
  busy: boolean;
  checkoutLoading: boolean;
  interacEnabled: boolean;
  interacPendingPayment: Payment | null;
  canProceedWithWaiver: boolean;
  startCheckout: (kind: 'individual' | 'family', provider?: 'stripe' | 'interac') => Promise<void>;
  viewInteracInstructions: (payment: Payment) => void;
  act: (action: FamilyAction, extra?: FamilyActionData) => Promise<void>;
  selected: string;
  setSelected: Dispatch<SetStateAction<string>>;
  eligiblePeople: Person[];
  incoming: FamilyEntry[];
  money: (amountMinor: number) => string;
  date: (value: string | null | undefined) => string;
}) {
  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Family membership</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Manage your family group or invite another approved member. Invited members must
              accept before they are added to the group. Each member accepts their own waiver
              separately; accepting an invitation does not sign it.
            </p>
          </div>
        </div>
        {currentFamily && (
          <span className="rounded-full border border-border px-2.5 py-1 text-xs capitalize">
            {displayedFamilyStatus?.replaceAll('_', ' ')}
          </span>
        )}
      </div>
      {currentFamily ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {currentMembers.map((m) => (
              <div key={m.id} className="rounded-lg bg-muted/40 p-3">
                <p className="font-medium">
                  {m.profiles?.full_name || m.profiles?.email || 'Member'}
                  {m.user_id === me?.id ? ' (you)' : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.profiles?.email || 'No email'} · {m.status.replaceAll('_', ' ')} ·{' '}
                  {currentWaiver &&
                  m.waiver_version === String(currentWaiver.version) &&
                  m.waiver_accepted_at
                    ? `Individual waiver accepted on ${date(m.waiver_accepted_at)}`
                    : 'Individual waiver acceptance needed'}
                </p>
              </div>
            ))}
          </div>
          {!familyPaid &&
            activeMembershipStatus === 'confirmed' &&
            me?.application_status === 'approved' && (
              <div className="mt-4">
                <PaymentOptionsButton
                  disabled={busy}
                  options={[
                    {
                      label: `Family by card · ${money(settings?.family_price_cents ?? 22000)}`,
                      onSelect: () => void startCheckout('family'),
                      disabled:
                        checkoutLoading ||
                        !canProceedWithWaiver ||
                        !currentWaiver ||
                        !settings ||
                        !familyWaiversComplete,
                      loading: checkoutLoading && !interacPendingPayment,
                      loadingLabel: 'Starting checkout',
                    },
                    ...(interacEnabled
                      ? [
                          {
                            label: interacPendingPayment
                              ? `View Interac instructions · ${money(interacPendingPayment.amount_minor)}`
                              : `Family by Interac · ${money(settings?.family_price_cents ?? 22000)}`,
                            onSelect: () =>
                              interacPendingPayment
                                ? viewInteracInstructions(interacPendingPayment)
                                : void startCheckout('family', 'interac'),
                            disabled:
                              checkoutLoading ||
                              (!interacPendingPayment &&
                                (!canProceedWithWaiver || !settings || !familyWaiversComplete)),
                            loading: checkoutLoading && !!interacPendingPayment,
                            loadingLabel: 'Starting Interac request',
                          },
                        ]
                      : []),
                  ]}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  At least two family members must be confirmed, and each member must individually
                  accept the current waiver before payment. If selected to pay by Interac,
                  membership is activated only after club confirmation.
                </p>
              </div>
            )}
          {activeMembershipStatus === 'confirmed' && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act('remove', { familyId: currentFamily?.id })}
              >
                Leave family
              </Button>
              {familyPaid && (
                <p className="text-xs text-muted-foreground">
                  Since this season is paid, leaving takes effect next season.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mt-5 max-w-xl">
          <label className="mb-2 block text-sm font-medium">Member to invite</label>
          <p className="mb-2 text-xs text-muted-foreground">
            Browse approved members by name and skill level. Members already in a family or with a
            pending invitation remain visible but cannot be selected.
          </p>
          <SearchableMemberSelect
            options={eligiblePeople}
            value={selected}
            onChange={setSelected}
            placeholder="Search by player name…"
          />
          <Button
            className="mt-3"
            disabled={busy || !selected}
            onClick={() => void act('invite', { userId: selected })}
          >
            {busy ? <TennisLoader compact label="Sending" /> : 'Send family invitation'}
          </Button>
        </div>
      )}
      {incoming.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="font-semibold">Pending invitations</h3>
          <div className="mt-3 space-y-2">
            {incoming.map((x) => (
              <div
                key={x.membership.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium">Invitation to join family membership</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Season {x.family.season_year}
                  </p>
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act('confirm', {
                      invitationId: x.membership.id,
                    })
                  }
                >
                  Accept invitation
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
