import { NextResponse } from 'next/server';
import { getMembershipSeason, type MembershipSeasonSettings } from '@/lib/membership-season';
import type { CheckoutBody } from '@/lib/payments/checkout-route-helpers';
import { getCheckoutServiceClient } from '@/lib/payments/checkout-route-helpers';

type CheckoutUser = { id: string };
type CheckoutPricingSettings = MembershipSeasonSettings & {
  family_price_cents: number;
  single_price_cents: number;
};
export type CheckoutTarget = {
  businessRecordId: string;
  amountMinor: number;
  currency: string;
  description: string;
};

export async function resolveCheckoutTarget(args: {
  db: ReturnType<typeof getCheckoutServiceClient>;
  body: CheckoutBody;
  user: CheckoutUser;
  settings: CheckoutPricingSettings | null;
}): Promise<CheckoutTarget | NextResponse> {
  const { db, body, user, settings } = args;
  let businessRecordId = body.businessRecordId?.trim() || '';
  let amountMinor = 0;
  const currency = 'cad';
  let description = '';
  if (body.purpose === 'membership') {
    if (!settings)
      return NextResponse.json({ error: 'Membership pricing is not configured.' }, { status: 503 });
    if (body.waiverAccepted !== true)
      return NextResponse.json(
        { error: 'You must accept the current membership waiver before paying.' },
        { status: 400 },
      );
    const { data: waiver, error: waiverError } = await db
      .from('legal_document_versions')
      .select('version')
      .eq('document_type', 'membership_waiver')
      .eq('is_current', true)
      .maybeSingle();
    if (waiverError || !waiver)
      return NextResponse.json(
        { error: 'The current membership waiver is unavailable.' },
        { status: 503 },
      );
    const season = getMembershipSeason(settings as MembershipSeasonSettings)!;
    if (body.waiverVersion !== undefined && body.waiverVersion !== waiver.version)
      return NextResponse.json(
        {
          error: 'The membership waiver changed. Refresh the page and review the current version.',
        },
        { status: 409 },
      );

    if (body.membershipKind === 'family') {
      if (!businessRecordId)
        return NextResponse.json({ error: 'A family membership is required.' }, { status: 400 });
      const { data: originalFamily } = await db
        .from('membership_families')
        .select('id,season_year,paid_at,payment_id')
        .eq('id', businessRecordId)
        .maybeSingle();
      const { data: familyLink } = await db
        .from('membership_family_members')
        .select('id,status')
        .eq('family_id', businessRecordId)
        .eq('user_id', user!.id)
        .eq('status', 'confirmed')
        .maybeSingle();
      if (!originalFamily || !familyLink)
        return NextResponse.json(
          { error: 'You are not authorized to pay for this family membership.' },
          { status: 403 },
        );
      const { data: confirmedFamilyMembers, error: confirmedMembersError } = await db
        .from('membership_family_members')
        .select('user_id,invited_by,waiver_version,waiver_accepted_at')
        .eq('family_id', originalFamily.id)
        .eq('status', 'confirmed');
      if (confirmedMembersError) throw new Error('Could not verify the confirmed family members.');
      if (!confirmedFamilyMembers || confirmedFamilyMembers.length < 2)
        return NextResponse.json(
          {
            error:
              'At least two family members must accept the invitation before family membership can be paid.',
          },
          { status: 409 },
        );
      if (
        originalFamily.season_year === season.year &&
        (originalFamily.paid_at || originalFamily.payment_id)
      ) {
        return NextResponse.json(
          { error: 'This family membership is already marked as paid for the current season.' },
          { status: 409 },
        );
      }
      if (originalFamily.season_year !== season.year) {
        const { data: renewedFamily, error: renewedFamilyError } = await db
          .from('membership_families')
          .insert({ season_year: season.year })
          .select('id')
          .single();
        if (renewedFamilyError || !renewedFamily)
          throw new Error('Could not create the family membership for the new season.');
        const { error: copyMembersError } = await db.from('membership_family_members').insert(
          confirmedFamilyMembers.map((member) => ({
            family_id: renewedFamily.id,
            user_id: member.user_id,
            invited_by: member.invited_by,
            status: 'confirmed',
            joined_at: new Date().toISOString(),
            waiver_version: member.waiver_version,
            waiver_accepted_at: member.waiver_accepted_at,
          })),
        );
        if (copyMembersError) {
          await db.from('membership_families').delete().eq('id', renewedFamily.id);
          throw new Error('Could not copy confirmed family members to the new season.');
        }
        businessRecordId = renewedFamily.id;
      }
      const { data: members, error: membersError } = await db
        .from('membership_family_members')
        .select(
          'user_id,waiver_version,waiver_accepted_at,profiles:profiles!membership_family_members_user_id_fkey(application_status)',
        )
        .eq('family_id', businessRecordId)
        .eq('status', 'confirmed');
      if (membersError || !members?.length)
        return NextResponse.json(
          { error: 'Every confirmed family member must have an approved profile.' },
          { status: 409 },
        );
      if (members.length < 2)
        return NextResponse.json(
          {
            error:
              'At least two family members must accept the invitation before family membership can be paid.',
          },
          { status: 409 },
        );
      if (
        members.some((m) => {
          const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
          return p?.application_status !== 'approved';
        })
      )
        return NextResponse.json(
          { error: 'Every confirmed family member must have an approved profile.' },
          { status: 409 },
        );
      if (
        members.some((m) => m.waiver_version !== String(waiver.version) || !m.waiver_accepted_at)
      ) {
        return NextResponse.json(
          {
            error:
              'Every confirmed family member must review and accept the current waiver before the family membership can be paid.',
          },
          { status: 409 },
        );
      }
      businessRecordId = `family:${businessRecordId}`;
      amountMinor = Number(settings.family_price_cents);
      description = `PCTC family membership — season ${season.year}`;
    } else {
      const targetSeason = season;
      let membership: {
        id: string;
        payment_status: string;
        starts_on: string | null;
        ends_on: string | null;
        waiver_version: string | null;
        waiver_accepted_at: string | null;
      } | null = null;
      if (businessRecordId) {
        const { data: existing, error: existingError } = await db
          .from('memberships')
          .select('id,user_id,payment_status,starts_on,ends_on,waiver_version,waiver_accepted_at')
          .eq('id', businessRecordId)
          .eq('user_id', user!.id)
          .maybeSingle();
        if (existingError) throw new Error('Could not verify the membership record.');
        if (!existing)
          return NextResponse.json({ error: 'Membership record not found.' }, { status: 404 });
        membership = existing;
      } else {
        const { data: currentMembership, error: membershipReadError } = await db
          .from('memberships')
          .select('id,payment_status,starts_on,ends_on,waiver_version,waiver_accepted_at')
          .eq('user_id', user!.id)
          .eq('starts_on', targetSeason.startsOn)
          .eq('ends_on', targetSeason.endsOn)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (membershipReadError) throw new Error('Could not check for a current membership.');
        membership = currentMembership;
      }
      if (!membership)
        return NextResponse.json(
          { error: 'Accept the current membership waiver before paying.' },
          { status: 409 },
        );
      if (
        membership.starts_on !== targetSeason.startsOn ||
        membership.ends_on !== targetSeason.endsOn
      )
        return NextResponse.json(
          {
            error:
              'This membership record belongs to another season. Refresh the page and start checkout for the current season.',
          },
          { status: 409 },
        );
      if (membership.payment_status === 'paid')
        return NextResponse.json({ error: 'This membership is already paid.' }, { status: 409 });
      if (membership.waiver_version !== String(waiver.version) || !membership.waiver_accepted_at)
        return NextResponse.json(
          { error: 'Accept the current membership waiver before paying.' },
          { status: 409 },
        );
      businessRecordId = membership.id;
      amountMinor = Number(settings.single_price_cents);
      description = 'PCTC individual membership';
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      return NextResponse.json(
        { error: 'Membership price must be configured to a positive amount.' },
        { status: 503 },
      );
  } else if (body.purpose === 'event_registration') {
    if (!businessRecordId)
      return NextResponse.json({ error: 'An event registration is required.' }, { status: 400 });
    const { data: registration } = await db
      .from('registrations')
      .select(
        'id,event_id,user_id,status,payment_status,amount_cents,guest_count,created_at,event:events(id,title,event_type,price_cents,guest_price_cents,status,starts_at,registration_opens_at,registration_closes_at,members_only)',
      )
      .eq('id', businessRecordId)
      .eq('user_id', user!.id)
      .maybeSingle();
    const event = Array.isArray(registration?.event) ? registration.event[0] : registration?.event;
    if (!registration || !event)
      return NextResponse.json({ error: 'Event registration not found.' }, { status: 404 });
    if (registration.status !== 'confirmed')
      return NextResponse.json(
        {
          error:
            'Only confirmed event registrations can be paid. Waitlisted registrations are not charged.',
        },
        { status: 409 },
      );
    if (registration.payment_status === 'paid' || registration.payment_status === 'not_required')
      return NextResponse.json(
        { error: 'This registration does not require payment.' },
        { status: 409 },
      );
    if (registration.payment_status === 'refunded')
      return NextResponse.json(
        {
          error:
            'This registration has been refunded. Contact the club before attempting another payment.',
        },
        { status: 409 },
      );
    const now = Date.now();
    const registeredAt = new Date(registration.created_at).getTime();
    if (
      event.status !== 'published' ||
      new Date(event.starts_at).getTime() <= now ||
      registeredAt < new Date(event.registration_opens_at).getTime() ||
      (event.registration_closes_at &&
        registeredAt >= new Date(event.registration_closes_at).getTime())
    ) {
      return NextResponse.json(
        {
          error:
            'This registration was not created during the event registration window, or the event has already started.',
        },
        { status: 409 },
      );
    }
    amountMinor = Number(registration.amount_cents);
    const configuredAmount =
      Number(event.price_cents) +
      (event.event_type === 'party'
        ? Number(event.guest_price_cents ?? 0) * Number(registration.guest_count ?? 0)
        : 0);
    if (
      amountMinor <= 0 ||
      registration.amount_cents !== amountMinor ||
      (event.event_type === 'party'
        ? amountMinor !== configuredAmount
        : amountMinor !== Number(event.price_cents))
    )
      return NextResponse.json(
        { error: 'Event price does not match the registration. Refresh and try again.' },
        { status: 409 },
      );
    description = `PCTC event registration — ${event.title}`;
  } else {
    const participantIds = [
      ...new Set(
        businessRecordId
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !participantIds.length ||
      participantIds.length > 2 ||
      participantIds.some(
        (id) =>
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
      )
    ) {
      return NextResponse.json(
        { error: 'Select one or two valid tournament entries to pay.' },
        { status: 400 },
      );
    }
    participantIds.sort();
    businessRecordId = participantIds.join(',');
    const { data: entries, error: entriesError } = await db
      .from('tournament_participants')
      .select(
        'id,event_id,user_id,amount_cents,payment_status,status,display_name,confirmation_status',
      )
      .in('id', participantIds);
    if (entriesError) throw new Error('Could not verify tournament entries.');
    if (
      !entries ||
      entries.length !== participantIds.length ||
      entries.some((entry) => entry.event_id !== entries[0].event_id) ||
      entries.some(
        (entry) => entry.status !== 'registered' || entry.confirmation_status !== 'confirmed',
      )
    ) {
      return NextResponse.json(
        {
          error:
            'One or more tournament entries are not eligible for payment. Check their payment status and try again.',
        },
        { status: 409 },
      );
    }
    if (!entries.some((entry) => entry.user_id === user!.id)) {
      return NextResponse.json(
        { error: 'The payer must be a registered participant in the selected entries.' },
        { status: 403 },
      );
    }
    const { data: eventPairs, error: eventPairsError } = await db
      .from('tournament_pairs')
      .select('player_one_id,player_two_id')
      .eq('event_id', entries[0].event_id)
      .eq('status', 'active');
    if (eventPairsError) throw new Error('Could not verify tournament partner confirmations.');
    const selectedIds = new Set(participantIds);
    const partnerIds = [
      ...new Set(
        (eventPairs ?? []).flatMap((pair) => {
          const selectedOne = selectedIds.has(pair.player_one_id);
          const selectedTwo = selectedIds.has(pair.player_two_id);
          return selectedOne && !selectedTwo
            ? [pair.player_two_id]
            : selectedTwo && !selectedOne
              ? [pair.player_one_id]
              : [];
        }),
      ),
    ];
    if (partnerIds.length) {
      const { data: partners, error: partnersError } = await db
        .from('tournament_participants')
        .select('id,status,confirmation_status')
        .in('id', partnerIds);
      if (
        partnersError ||
        partners?.length !== partnerIds.length ||
        partners.some(
          (partner) =>
            partner.status !== 'registered' || partner.confirmation_status !== 'confirmed',
        )
      )
        return NextResponse.json(
          { error: 'Your partner must confirm before this team can pay.' },
          { status: 409 },
        );
    }
    const unpaidEntries = entries.filter((entry) =>
      ['pending', 'failed'].includes(entry.payment_status),
    );
    if (!unpaidEntries.length)
      return NextResponse.json(
        { error: 'The selected tournament entries are already paid.' },
        { status: 409 },
      );
    businessRecordId = unpaidEntries
      .map((entry) => entry.id)
      .sort()
      .join(',');
    const eventId = entries[0].event_id;
    if (entries.some((entry) => entry.event_id !== eventId))
      return NextResponse.json(
        { error: 'Entries must belong to the same tournament.' },
        { status: 400 },
      );
    const { data: tournamentEvent } = await db
      .from('events')
      .select('id,title,event_type,status,starts_at,price_cents')
      .eq('id', eventId)
      .maybeSingle();
    if (
      !tournamentEvent ||
      tournamentEvent.event_type !== 'tournament' ||
      tournamentEvent.status !== 'published' ||
      new Date(tournamentEvent.starts_at).getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: 'This tournament is not accepting payment.' },
        { status: 409 },
      );
    }
    amountMinor = unpaidEntries.reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      return NextResponse.json(
        { error: 'The selected tournament entries do not require payment.' },
        { status: 409 },
      );
    description = `PCTC tournament entries — ${tournamentEvent.title} (${unpaidEntries.length} participant${unpaidEntries.length === 1 ? '' : 's'})`;
  }

  return { businessRecordId, amountMinor, currency, description };
}
