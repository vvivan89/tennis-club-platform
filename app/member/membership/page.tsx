'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock3, CreditCard } from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { PaymentOptionsButton } from '@/components/payment-options-button';
import { MemberNav } from '@/components/member-nav';
import { MembershipFamilySection } from '@/components/membership-family-section';
import { FloatingFeedback } from '@/components/floating-feedback';
import {
  InteracPaymentInstructionsDialog,
  type InteracPaymentNotice,
} from '@/components/interac-payment-instructions-dialog';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { getMembershipSeason } from '@/lib/membership-season';
import type { MembershipPortalState, Payment, Profile } from '@/app/member/membership-types';
const emptyState: MembershipPortalState = {
  families: [],
  people: [],
  settings: null,
  memberships: [],
  payments: [],
  currentWaiver: null,
};
const money = (c: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((c || 0) / 100);
const date = (v: string | null | undefined) => {
  if (!v) return '—';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const value = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(v);
  return value.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
};
const dateWithOrdinal = (v: string | null | undefined) => {
  if (!v) return '—';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!dateOnly) return date(v);
  const year = Number(dateOnly[1]);
  const month = Number(dateOnly[2]) - 1;
  const day = Number(dateOnly[3]);
  const remainder = day % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th';
  const monthName = new Date(year, month, 1).toLocaleDateString('en-CA', { month: 'short' });
  return `${monthName} ${day}${suffix}, ${year}`;
};
const getTargetSeason = getMembershipSeason;
export default function MembershipPortal() {
  const [state, setState] = useState<MembershipPortalState>(emptyState);
  const [me, setMe] = useState<Profile | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [waiverSaving, setWaiverSaving] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [interacEnabled, setInteracEnabled] = useState(false);
  const [interacRecipientEmail, setInteracRecipientEmail] = useState('');
  const [interacInstructions, setInteracInstructions] = useState('');
  const [message, setMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [toastError, setToastError] = useState('');
  const [interacNotice, setInteracNotice] = useState<InteracPaymentNotice | null>(null);
  const [club, setClub] = useState<{
    club_name: string;
    short_name: string;
    social_links: { url: string }[];
  }>({ club_name: 'Port Coquitlam Tennis Club', short_name: '', social_links: [] });
  const load = useCallback(async () => {
    setLoading(true);
    const db = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    const [{ data: profile }, { data: cs }, { data: methodSettings }] = await Promise.all([
      user
        ? db
            .from('profiles')
            .select('id,full_name,email,application_status')
            .eq('id', user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from('club_settings')
        .select('club_name,short_name,social_links')
        .eq('id', 1)
        .maybeSingle(),
      db
        .from('payment_method_settings')
        .select('interac_enabled,interac_recipient_email,interac_instructions')
        .eq('id', 1)
        .maybeSingle(),
    ]);
    setMe(profile);
    if (cs) setClub(cs);
    setInteracEnabled(methodSettings?.interac_enabled === true);
    setInteracRecipientEmail(methodSettings?.interac_recipient_email || '');
    setInteracInstructions(methodSettings?.interac_instructions || '');
    if (user) {
      const r = await fetch('/api/membership/family');
      const j = await r.json();
      if (r.ok) setState({ ...emptyState, ...j });
      else {
        console.error('[Member membership] Load failed', { status: r.status, result: j });
        setMessage('Unable to load membership information. Please try again.');
      }
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(
    action: 'invite' | 'confirm' | 'remove' | 'accept_waiver',
    extra: {
      userId?: string;
      invitationId?: string;
      familyId?: string;
      waiverAccepted?: boolean;
      waiverVersion?: number;
    } = {},
  ) {
    const savingWaiver = action === 'accept_waiver';
    if (savingWaiver) setWaiverSaving(true);
    else setBusy(true);
    setMessage('');
    setToastMessage('');
    setToastError('');
    try {
      const r = await fetch('/api/membership/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await r.json();
      if (!r.ok) {
        console.error('[Member membership] Family membership update failed', {
          status: r.status,
          result: j,
        });
        throw new Error(j.error || 'Could not update family membership. Please try again.');
      }
      if (action === 'invite') {
        const invitee = state.people.find((person) => person.id === extra.userId);
        const inviteeName = invitee?.full_name || invitee?.email || 'the selected member';
        if (j.warning) setToastError(j.warning);
        else
          setToastMessage(
            j.familyCreated
              ? `Family created. An invitation was sent to ${inviteeName}. Family payment will be available after they accept the invitation and individually accept their waiver.`
              : `Invitation sent to ${inviteeName}. Family payment will be available after they accept the invitation and individually accept their waiver.`,
          );
      } else if (action === 'confirm') {
        setToastMessage(
          'You accepted the family invitation. Review and accept your waiver separately.',
        );
      } else if (action === 'remove') {
        setToastMessage(
          j.effectiveNextSeason
            ? 'You are scheduled to leave the family at the end of the current paid season.'
            : 'You left the family membership.',
        );
      } else {
        setToastMessage(
          j.acceptedAt
            ? `Your waiver acceptance was saved on ${date(j.acceptedAt)}.`
            : 'Your waiver acceptance was saved.',
        );
      }
      setSelected('');
      await load();
    } catch (e) {
      console.error('[Member membership] Family membership request failed', e);
      setToastError(
        e instanceof Error ? e.message : 'Could not update family membership. Please try again.',
      );
    } finally {
      if (savingWaiver) setWaiverSaving(false);
      else setBusy(false);
    }
  }
  async function startCheckout(
    kind: 'individual' | 'family',
    provider: 'stripe' | 'interac' = 'stripe',
  ) {
    if (!canProceedWithWaiver) {
      setMessage('Accept the current membership waiver before continuing to checkout.');
      return;
    }
    setToastMessage('');
    setToastError('');
    setCheckoutLoading(true);
    setMessage('');
    try {
      const body: Record<string, unknown> = {
        purpose: 'membership',
        provider,
        returnTo: '/member/membership',
        returnLabel: 'Back to membership',
        membershipKind: kind,
        waiverAccepted: true,
        waiverVersion: state.currentWaiver?.version,
        idempotencyKey: crypto.randomUUID(),
      };
      const targetSeason = getTargetSeason(state.settings);
      const latestMembership = state.memberships[0];
      if (
        kind === 'individual' &&
        latestMembership?.id &&
        targetSeason &&
        latestMembership.starts_on === targetSeason.startsOn &&
        latestMembership.ends_on === targetSeason.endsOn &&
        latestMembership.payment_status !== 'paid'
      )
        body.businessRecordId = latestMembership.id;
      if (kind === 'family' && active?.family?.id) body.businessRecordId = active.family.id;
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start checkout.');
      if (provider === 'interac') {
        setInteracNotice({
          amount: money(result.amountMinor),
          recipientEmail: result.recipientEmail,
          paymentId: result.paymentId,
          instructions: result.instructions || '',
          message: result.message || '',
        });
        setToastMessage(
          'Interac payment request submitted. Your membership remains unpaid until the club confirms receipt.',
        );
        await load();
        setCheckoutLoading(false);
        return;
      }
      if (!result.checkoutUrl) throw new Error('Could not start checkout.');
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      console.error('[Member membership] Checkout start failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      setToastError(
        error instanceof Error ? error.message : 'Could not start checkout. Please try again.',
      );
      await load();
      setCheckoutLoading(false);
    }
  }
  const active = [...state.families]
    .filter(
      (x) =>
        x.membership.user_id === me?.id &&
        ['confirmed', 'pending', 'removed_next_season'].includes(x.membership.status),
    )
    .sort(
      (a, b) =>
        new Date(b.membership.joined_at || b.membership.created_at || 0).getTime() -
        new Date(a.membership.joined_at || a.membership.created_at || 0).getTime(),
    )[0];
  const currentFamily = active?.family;
  const currentMembers = active?.members ?? [];
  const confirmedFamilyMembers = currentMembers.filter((member) => member.status === 'confirmed');
  const familyWaiversComplete =
    confirmedFamilyMembers.length >= 2 &&
    Boolean(state.currentWaiver) &&
    confirmedFamilyMembers.every(
      (member) =>
        member.waiver_version === String(state.currentWaiver?.version) &&
        Boolean(member.waiver_accepted_at),
    );
  const incoming = state.families.filter(
    (x) => x.membership.user_id === me?.id && x.membership.status === 'pending',
  );
  const latest = state.memberships?.[0];
  const targetSeason = getTargetSeason(state.settings);
  const latestIsCurrentSeason = Boolean(
    targetSeason &&
    latest?.starts_on === targetSeason.startsOn &&
    latest?.ends_on === targetSeason.endsOn,
  );
  const latestPayment = (state.payments ?? []).find(
    (p) => p.business_record_id === latest?.id && p.status === 'succeeded',
  );
  const familyPaid = Boolean(
    currentFamily &&
    targetSeason &&
    currentFamily.season_year === targetSeason.year &&
    (currentFamily.paid_at || currentFamily.payment_id),
  );
  const familyPending =
    active?.membership.status === 'confirmed' && !familyPaid && !familyWaiversComplete;
  const displayedFamilyStatus = familyPending ? 'pending' : active?.membership.status;
  const familyType =
    active?.membership.status === 'confirmed'
      ? familyPending
        ? 'Family membership · pending'
        : 'Family membership'
      : active?.membership.status === 'pending'
        ? 'Family invitation pending'
        : active?.membership.status === 'removed_next_season'
          ? 'Family membership · leaving next season'
          : null;
  const type =
    familyType ||
    (latest?.membership_type
      ? String(latest.membership_type)
          .replaceAll('_', ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : 'No membership record');
  const isActiveFamily =
    active?.membership.status === 'confirmed' ||
    active?.membership.status === 'removed_next_season';
  const interacPendingPayment = [...(state.payments ?? [])]
    .filter((payment) => {
      const recordId =
        isActiveFamily && currentFamily
          ? `family:${currentFamily.id}`
          : latestIsCurrentSeason
            ? latest?.id
            : null;
      return (
        payment.purpose === 'membership' &&
        payment.provider === 'interac' &&
        payment.status === 'pending' &&
        payment.business_record_id === recordId
      );
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const viewInteracInstructions = (payment: Payment) =>
    setInteracNotice({
      amount: money(payment.amount_minor),
      recipientEmail: interacRecipientEmail,
      paymentId: payment.id,
      instructions: interacInstructions,
      message:
        'This Interac payment request is pending. Your membership will be activated after the club confirms receipt.',
    });
  const currentWaiverVersion = String(state.currentWaiver?.version);
  const waiverRecord = isActiveFamily
    ? active?.membership
    : active?.membership.status === 'pending' &&
        active.membership.waiver_version === currentWaiverVersion &&
        active.membership.waiver_accepted_at
      ? active.membership
      : state.memberships.find(
          (membership) =>
            membership.waiver_version === currentWaiverVersion &&
            Boolean(membership.waiver_accepted_at),
        );
  const waiverAcceptedAt =
    state.currentWaiver && waiverRecord?.waiver_version === String(state.currentWaiver.version)
      ? waiverRecord.waiver_accepted_at
      : null;
  const canProceedWithWaiver = Boolean(waiverAcceptedAt);
  const paid = isActiveFamily
    ? familyPaid
    : Boolean(
        latestIsCurrentSeason && latest && (latest.payment_status === 'paid' || latestPayment),
      );
  const paidAt = isActiveFamily
    ? familyPaid
      ? (currentFamily?.paid_at ?? null)
      : null
    : latestIsCurrentSeason
      ? latestPayment?.succeeded_at || latestPayment?.created_at || null
      : null;
  const familyPlan = Boolean(
    active?.membership.status === 'confirmed' ||
    (active?.membership.status === 'removed_next_season' && familyPaid) ||
    (latestIsCurrentSeason &&
      String(latest?.membership_type || '')
        .toLowerCase()
        .includes('family')),
  );
  const currentPrice = familyPlan
    ? (state.settings?.family_price_cents ?? 22000)
    : (state.settings?.single_price_cents ?? 15000);
  const ordinal = (day: number) => {
    const mod100 = day % 100;
    const suffix =
      mod100 >= 11 && mod100 <= 13
        ? 'th'
        : day % 10 === 1
          ? 'st'
          : day % 10 === 2
            ? 'nd'
            : day % 10 === 3
              ? 'rd'
              : 'th';
    return `${day}${suffix}`;
  };
  const seasonLabel = state.settings
    ? `${new Date(2024, state.settings.season_start_month - 1, 1).toLocaleString('en-CA', { month: 'long' })} ${ordinal(state.settings.season_start_day)} - ${new Date(2024, state.settings.season_end_month - 1, 1).toLocaleString('en-CA', { month: 'long' })} ${ordinal(state.settings.season_end_day)}`
    : 'April 1st - September 30th';
  const eligiblePeople = useMemo(
    () =>
      state.people
        .filter((p) => p.id !== me?.id)
        .sort((a, b) =>
          String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')),
        ),
    [state.people, me?.id],
  );
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        clubName={club.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club.short_name}
      />
      <MemberNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Member portal</p>
        <h1 className="section-title">Membership</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your membership, payments, and family plan for the club season ({seasonLabel}).
        </p>
        <p className="mt-3 text-sm">
          <Link className="underline underline-offset-4" href="/member/payments">
            View full payment history
          </Link>
        </p>
        <FloatingFeedback error={toastError} message={toastMessage} />
        {message && (
          <p role="status" className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {message}
          </p>
        )}
        {!loading &&
          me?.application_status === 'approved' &&
          (state.currentWaiver || state.memberships.length === 0 || !paid) && (
            <section className="mt-5 rounded-xl border border-border p-4">
              <h2 className="font-semibold">Your membership waiver</h2>
              {state.currentWaiver ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {state.currentWaiver.title} · version {state.currentWaiver.version}
                  </p>
                  <details className="mt-3 rounded-md bg-muted/40 p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Read the current waiver
                    </summary>
                    <div
                      className="prose prose-sm dark:prose-invert mt-3 max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(state.currentWaiver.body_html),
                      }}
                    />
                  </details>
                  {waiverAcceptedAt ? (
                    <p className="mt-3 text-sm font-medium text-foreground">
                      Waiver is accepted on {date(waiverAcceptedAt)}
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3"
                      disabled={waiverSaving}
                      onClick={() => {
                        const familyId = isActiveFamily ? active?.family.id : undefined;
                        void act('accept_waiver', {
                          familyId,
                          waiverAccepted: true,
                          waiverVersion: state.currentWaiver?.version,
                        });
                      }}
                    >
                      {waiverSaving
                        ? 'Saving your waiver acceptance…'
                        : 'I have read and accept the current membership waiver.'}
                    </Button>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-destructive">
                  The current membership waiver is unavailable. Contact the club administrator
                  before paying.
                </p>
              )}
            </section>
          )}
        {loading ? (
          <TennisLoader label="Loading membership details" />
        ) : (
          <div className="mt-7 space-y-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="rounded-xl border border-border p-5 lg:col-span-2">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">Your membership</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Current membership type and payment status.
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${paid ? 'bg-success/15 text-success-foreground dark:bg-success/20 dark:text-success-foreground' : 'bg-warning/15 text-warning-foreground dark:bg-warning/20 dark:text-warning-foreground'}`}
                  >
                    {paid ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Clock3 className="h-3.5 w-3.5" />
                    )}
                    {paid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Membership type
                    </p>
                    <p className="mt-1 text-xl font-semibold">{type}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Season fee
                    </p>
                    <p className="mt-1 text-xl font-semibold">
                      {currentPrice == null ? '—' : money(currentPrice)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Paid date
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {paid
                        ? date(paidAt)
                        : interacPendingPayment
                          ? 'Interac payment pending club confirmation'
                          : 'No payment recorded'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Membership period
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {latest?.starts_on || latest?.ends_on
                        ? `${dateWithOrdinal(latest.starts_on)} – ${dateWithOrdinal(latest.ends_on)}`
                        : currentFamily
                          ? `Season ${currentFamily.season_year}`
                          : 'No dates recorded'}
                    </p>
                  </div>
                </div>
                {interacPendingPayment && (
                  <p
                    role="status"
                    className="mt-4 rounded-md border border-warning bg-warning/10 p-3 text-sm text-warning-foreground dark:border-warning dark:bg-warning/30 dark:text-warning-foreground"
                  >
                    Your Interac membership payment has been requested and is awaiting club
                    confirmation.
                  </p>
                )}
                {active?.membership.status === 'removed_next_season' && (
                  <p className="mt-4 rounded-md bg-muted p-3 text-sm">
                    Your family membership remains in effect for the current season and is scheduled
                    to end next season.
                  </p>
                )}
                {!paid &&
                  (!isActiveFamily || active?.membership.status === 'removed_next_season') &&
                  me?.application_status === 'approved' && (
                    <div className="mt-5 border-t border-border pt-4">
                      <PaymentOptionsButton
                        disabled={busy}
                        options={[
                          {
                            label: `Individual by card · ${money(state.settings?.single_price_cents ?? 15000)}`,
                            onSelect: () => void startCheckout('individual'),
                            disabled:
                              checkoutLoading ||
                              !canProceedWithWaiver ||
                              !state.currentWaiver ||
                              !state.settings,
                            loading: checkoutLoading && !interacPendingPayment,
                            loadingLabel: 'Starting checkout',
                          },
                          ...(interacEnabled
                            ? [
                                {
                                  label: interacPendingPayment
                                    ? `View Interac instructions · ${money(interacPendingPayment.amount_minor)}`
                                    : `Individual by Interac · ${money(state.settings?.single_price_cents ?? 15000)}`,
                                  onSelect: () =>
                                    interacPendingPayment
                                      ? viewInteracInstructions(interacPendingPayment)
                                      : void startCheckout('individual', 'interac'),
                                  disabled:
                                    checkoutLoading ||
                                    (!interacPendingPayment &&
                                      (!canProceedWithWaiver ||
                                        !state.currentWaiver ||
                                        !state.settings)),
                                  loading: checkoutLoading && !!interacPendingPayment,
                                  loadingLabel: 'Starting Interac request',
                                },
                              ]
                            : []),
                        ]}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Stripe payments are confirmed automatically. Interac payments remain pending
                        until the club confirms receipt.
                      </p>
                    </div>
                  )}
              </section>
              <section className="rounded-xl border border-border p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Season details</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Plan prices and limits.</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Single membership</span>
                    <strong>{money(state.settings?.single_price_cents ?? 15000)}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Family membership</span>
                    <strong>{money(state.settings?.family_price_cents ?? 22000)}</strong>
                  </div>
                  <div className="border-t border-border pt-3 text-muted-foreground">
                    Family limit: {state.settings?.family_max_adults ?? 2} adults and{' '}
                    {state.settings?.family_max_children ?? 4} children.
                  </div>
                </div>
              </section>
            </div>
            <MembershipFamilySection
              currentFamily={currentFamily}
              activeMembershipStatus={active?.membership.status}
              displayedFamilyStatus={displayedFamilyStatus}
              currentMembers={currentMembers}
              me={me}
              currentWaiver={state.currentWaiver}
              settings={state.settings}
              familyPaid={familyPaid}
              familyWaiversComplete={familyWaiversComplete}
              busy={busy}
              checkoutLoading={checkoutLoading}
              interacEnabled={interacEnabled}
              interacPendingPayment={interacPendingPayment}
              canProceedWithWaiver={canProceedWithWaiver}
              startCheckout={startCheckout}
              viewInteracInstructions={viewInteracInstructions}
              act={act}
              selected={selected}
              setSelected={setSelected}
              eligiblePeople={eligiblePeople}
              incoming={incoming}
              money={money}
              date={date}
            />
            {state.payments?.length > 0 && (
              <section className="rounded-xl border border-border p-5">
                <h2 className="text-lg font-semibold">Payment history</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 font-medium">Amount</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.payments.map((p) => (
                        <tr key={p.id} className="border-t border-border">
                          <td className="whitespace-nowrap px-3 py-2">
                            {date(p.succeeded_at || p.created_at)}
                          </td>
                          <td className="px-3 py-2">
                            {p.purpose === 'membership'
                              ? 'Membership payment'
                              : p.purpose?.replaceAll('_', ' ') || 'Other'}
                          </td>
                          <td className="px-3 py-2">{money(p.amount_minor)}</td>
                          <td className="px-3 py-2 capitalize">
                            {String(p.status).replaceAll('_', ' ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <SiteFooter
        clubName={club.club_name}
        shortName={club.short_name}
        socialLinks={Array.isArray(club.social_links) ? club.social_links : []}
      />
      <InteracPaymentInstructionsDialog
        notice={interacNotice}
        onClose={() => setInteracNotice(null)}
      />
    </main>
  );
}
