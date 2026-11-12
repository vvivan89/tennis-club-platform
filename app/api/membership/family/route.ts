import { NextResponse } from 'next/server';
import { getSignedInUser } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { escapeHtml as esc, sendResendEmail } from '@/lib/resend';
import { getSiteOrigin } from '@/lib/site-url';
import { enforceRateLimit } from '@/lib/rate-limit';
import { DEFAULT_MEMBERSHIP_SEASON_SETTINGS, getMembershipSeason } from '@/lib/membership-season';
type FamilyRecord = {
  id: string;
  season_year: number;
  paid_at: string | null;
  paid_by: string | null;
  payment_id: string | null;
};
type FamilyEntry = {
  membership: {
    id: string;
    family_id: string;
    user_id: string;
    invited_by: string | null;
    status: string;
    joined_at: string | null;
    created_at: string;
    waiver_version?: string | null;
    waiver_accepted_at?: string | null;
  };
  family: FamilyRecord;
  members: {
    id: string;
    user_id: string;
    status: string;
    invited_by: string | null;
    joined_at: string | null;
    waiver_version?: string | null;
    waiver_accepted_at?: string | null;
    profiles: {
      id: string;
      full_name: string | null;
      email: string | null;
      date_of_birth: string | null;
    } | null;
  }[];
};
type FamilyAgeMember = {
  user_id: string;
  status?: string;
  profiles: { date_of_birth: string | null } | null;
};
function countFamilyAdultsAndChildren(members: FamilyAgeMember[]) {
  const now = new Date();
  return members.reduce(
    (counts, member) => {
      const dateOfBirth = member.profiles?.date_of_birth;
      if (!dateOfBirth) {
        counts.adults++;
        return counts;
      }
      const born = new Date(dateOfBirth);
      let age = now.getFullYear() - born.getFullYear();
      if (
        now.getMonth() < born.getMonth() ||
        (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
      ) {
        age--;
      }
      if (age < 18) counts.children++;
      else counts.adults++;
      return counts;
    },
    { adults: 0, children: 0 },
  );
}
type PaymentRecord = {
  id: string;
  purpose: string;
  business_record_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  created_at: string;
  succeeded_at: string | null;
  refunded_amount_minor: number;
  provider: string | null;
  manual_review_status: string | null;
};
export async function GET() {
  try {
    const { user, response: authError } = await getSignedInUser();
    if (authError) return authError;
    const db = createServiceRoleClient();
    const { data: me } = await db
      .from('profiles')
      .select('id,full_name,email,date_of_birth,application_status,account_kind')
      .eq('id', user.id)
      .maybeSingle();
    /* A missing profile should not render a dead-end error block. */ const { data: rows } =
      await db
        .from('membership_family_members')
        .select(
          'id,family_id,user_id,invited_by,status,joined_at,created_at,waiver_version,waiver_accepted_at',
        )
        .or(`user_id.eq.${user.id},invited_by.eq.${user.id}`)
        .order('created_at', { ascending: false });
    const families: FamilyEntry[] = [];
    const familyIds = [...new Set((rows ?? []).map((row) => row.family_id))];
    const { data: familyRecords } = familyIds.length
      ? await db
          .from('membership_families')
          .select('id,season_year,paid_at,paid_by,payment_id')
          .in('id', familyIds)
      : { data: [] as FamilyRecord[] };
    const familyById = new Map<string, FamilyRecord>(
      (familyRecords ?? []).map((f) => [f.id, f] as [string, FamilyRecord]),
    );
    for (const row of rows ?? []) {
      const f = familyById.get(row.family_id);
      if (!f) continue;
      const { data: members } = await db
        .from('membership_family_members')
        .select(
          'id,user_id,status,invited_by,joined_at,waiver_version,waiver_accepted_at,profiles:profiles!membership_family_members_user_id_fkey(id,full_name,email,date_of_birth)',
        )
        .eq('family_id', row.family_id)
        .order('created_at', { ascending: true });
      families.push({
        membership: row,
        family: f,
        members: (members ?? []).map((member) => ({
          ...member,
          profiles: Array.isArray(member.profiles)
            ? (member.profiles[0] ?? null)
            : (member.profiles ?? null),
        })) as FamilyEntry['members'],
      });
    }
    const [peopleResult, settingsResult, membershipsResult, occupiedResult] = await Promise.all([
      db
        .from('profiles')
        .select('id,full_name,tennis_skill_level,date_of_birth')
        .eq('application_status', 'approved')
        .neq('id', user.id)
        .order('full_name'),
      db.from('membership_plan_settings').select('*').eq('id', 1).maybeSingle(),
      db
        .from('memberships')
        .select(
          'id,user_id,membership_type,status,payment_status,starts_on,ends_on,created_at,waiver_version,waiver_accepted_at',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      db
        .from('membership_family_members')
        .select('user_id,status')
        .in('status', ['confirmed', 'pending']),
    ]);
    if (peopleResult.error)
      throw new Error(`Could not load approved member list: ${peopleResult.error.message}`);
    if (settingsResult.error)
      throw new Error(`Could not load membership prices: ${settingsResult.error.message}`);
    if (membershipsResult.error)
      throw new Error(`Could not load your membership: ${membershipsResult.error.message}`);
    if (occupiedResult.error)
      throw new Error(`Could not load family availability: ${occupiedResult.error.message}`);
    const allPeople = peopleResult.data;
    const settings = settingsResult.data;
    const memberships = membershipsResult.data;
    const occupied = occupiedResult.data;
    const occupiedIds = new Set((occupied ?? []).map((m) => m.user_id));
    const people = me
      ? (allPeople ?? []).map((p) => ({
          ...p,
          available: !occupiedIds.has(p.id),
          unavailableReason: 'Already in a family or has a pending invitation',
        }))
      : [];
    const membershipIds = (memberships ?? []).map((m) => m.id);
    const paymentRecordIds = [
      ...membershipIds.map(String),
      ...familyIds.map((id) => `family:${id}`),
    ];
    const [{ data: payments, error: paymentsError }, { data: currentWaiver }] = await Promise.all([
      paymentRecordIds.length
        ? db
            .from('payments')
            .select(
              'id,purpose,business_record_id,amount_minor,currency,status,created_at,succeeded_at,refunded_amount_minor,provider,manual_review_status',
            )
            .eq('purpose', 'membership')
            .in('business_record_id', paymentRecordIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as PaymentRecord[], error: null }),
      db
        .from('legal_document_versions')
        .select('version,title,body_html')
        .eq('document_type', 'membership_waiver')
        .eq('is_current', true)
        .maybeSingle(),
    ]);
    if (paymentsError) throw new Error(`Could not load payment history: ${paymentsError.message}`);
    return NextResponse.json({
      families,
      people: people ?? [],
      settings: settings ?? null,
      memberships: memberships ?? [],
      payments: payments ?? [],
      currentWaiver: currentWaiver ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected error.' },
      { status: 500 },
    );
  }
}
export async function POST(req: Request) {
  try {
    const { user, response: authError } = await getSignedInUser();
    if (authError) return authError;
    const limited = await enforceRateLimit(req, {
      name: 'family-invite',
      limit: 30,
      windowSeconds: 3600,
      userId: user.id,
    });
    if (limited) return limited;
    const db = createServiceRoleClient();
    const { data: me } = await db
      .from('profiles')
      .select('id,full_name,email,application_status,date_of_birth,account_kind')
      .eq('id', user.id)
      .maybeSingle();
    if (!me)
      return NextResponse.json(
        {
          error:
            'Your member profile is not available yet. Refresh the page or contact the club administrator.',
        },
        { status: 409 },
      );
    const b = await req.json();
    const action = String(b.action || '');
    const loadCurrentWaiver = async () => {
      const { data: waiver } = await db
        .from('legal_document_versions')
        .select('version')
        .eq('document_type', 'membership_waiver')
        .eq('is_current', true)
        .maybeSingle();
      if (!waiver) {
        return {
          waiver: null,
          response: NextResponse.json(
            { error: 'The current membership waiver is unavailable.' },
            { status: 503 },
          ),
        };
      }
      if (b.waiverVersion !== undefined && b.waiverVersion !== waiver.version) {
        return {
          waiver: null,
          response: NextResponse.json(
            {
              error:
                'The membership waiver changed. Refresh the page and review the current version.',
            },
            { status: 409 },
          ),
        };
      }
      return { waiver, response: null };
    };
    const { data: settings } = await db
      .from('membership_plan_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (action === 'invite') {
      const targetId = String(b.userId || '');
      if (!targetId || targetId === user.id)
        return NextResponse.json({ error: 'Choose another approved member.' }, { status: 400 });
      const { data: target } = await db
        .from('profiles')
        .select('id,full_name,email,application_status,date_of_birth')
        .eq('id', targetId)
        .maybeSingle();
      if (!target || target.application_status !== 'approved')
        return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
      const { data: myRows } = await db
        .from('membership_family_members')
        .select('id,family_id,status,membership_families(paid_at,season_year)')
        .eq('user_id', user.id)
        .in('status', ['confirmed', 'pending']);
      if ((myRows ?? []).some((x) => x.status === 'pending'))
        return NextResponse.json(
          { error: 'Resolve your pending family invitation first.' },
          { status: 409 },
        );
      const myConfirmed = (myRows ?? []).find((x) => x.status === 'confirmed');
      const { data: targetExisting } = await db
        .from('membership_family_members')
        .select('id,status')
        .eq('user_id', targetId)
        .in('status', ['confirmed', 'pending']);
      if (targetExisting?.length)
        return NextResponse.json(
          { error: 'That member already belongs to a family or has a pending invitation.' },
          { status: 409 },
        );
      let familyId: string;
      let created = false;
      if (myConfirmed) {
        familyId = myConfirmed.family_id;
      } else {
        const nowDate = new Date();
        const seasonYear = getMembershipSeason(settings, nowDate)?.year ?? nowDate.getFullYear();
        const { data: newFamily, error: familyErr } = await db
          .from('membership_families')
          .insert({ season_year: seasonYear })
          .select('id')
          .single();
        if (familyErr || !newFamily) throw familyErr || new Error('Could not create family.');
        familyId = newFamily.id;
        created = true;
        const { error: ownerErr } = await db.from('membership_family_members').insert({
          family_id: familyId,
          user_id: user.id,
          invited_by: user.id,
          status: 'confirmed',
          joined_at: new Date().toISOString(),
        });
        if (ownerErr) throw ownerErr;
      }
      const { data: confirmed } = await db
        .from('membership_family_members')
        .select('user_id,profiles:profiles!membership_family_members_user_id_fkey(date_of_birth)')
        .eq('family_id', familyId)
        .eq('status', 'confirmed');
      const { adults, children } = countFamilyAdultsAndChildren([
        ...(confirmed ?? []),
        { user_id: target.id, profiles: { date_of_birth: target.date_of_birth } },
      ] as FamilyAgeMember[]);
      if (
        settings &&
        (adults > settings.family_max_adults || children > settings.family_max_children)
      ) {
        if (created) await db.from('membership_families').delete().eq('id', familyId);
        return NextResponse.json(
          {
            error: `Family limit exceeded (${settings.family_max_adults} adults and ${settings.family_max_children} children).`,
          },
          { status: 409 },
        );
      }
      const { error: inviteErr } = await db
        .from('membership_family_members')
        .insert({ family_id: familyId, user_id: targetId, invited_by: user.id, status: 'pending' });
      if (inviteErr) throw inviteErr;
      if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
        const { data: clubSettings } = await db
          .from('club_settings')
          .select('short_name')
          .eq('id', 1)
          .maybeSingle();
        const shortName = clubSettings?.short_name || 'Tennis Club';
        const url = new URL('/member/membership', getSiteOrigin(req)).toString();
        const mail = await sendResendEmail({
          request: req,
          to: target.email,
          subject: `${shortName} family membership invitation`,
          html: `<p>Hello ${esc(target.full_name || 'member')},</p><p>${esc(me.full_name || me.email || 'A member')} invited you to join their ${esc(shortName)} family membership.</p><p>Sign in to your Member Portal and confirm the invitation: <a href="${esc(url)}">Review invitation</a>.</p>`,
        });
        if (!mail.ok)
          return NextResponse.json({
            success: true,
            familyCreated: created,
            warning:
              'Invitation saved, but the email could not be sent. Ask the member to check their portal.',
          });
      }
      return NextResponse.json({ success: true, familyCreated: created });
    }
    if (action === 'confirm') {
      const id = String(b.invitationId || '');
      const { data: inv } = await db
        .from('membership_family_members')
        .select('id,family_id,status')
        .eq('id', id)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .maybeSingle();
      if (!inv) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
      const { data: members } = await db
        .from('membership_family_members')
        .select(
          'user_id,status,profiles:profiles!membership_family_members_user_id_fkey(date_of_birth)',
        )
        .eq('family_id', inv.family_id)
        .eq('status', 'confirmed');
      const { data: myFamily } = await db
        .from('membership_family_members')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'confirmed');
      if (myFamily?.length)
        return NextResponse.json(
          { error: 'Leave your current family before accepting another invitation.' },
          { status: 409 },
        );
      const { adults, children } = countFamilyAdultsAndChildren([
        ...(members ?? []),
        { user_id: user.id, status: 'confirmed', profiles: { date_of_birth: me.date_of_birth } },
      ] as FamilyAgeMember[]);
      if (
        settings &&
        (adults > settings.family_max_adults || children > settings.family_max_children)
      )
        return NextResponse.json(
          {
            error: `This family is at its limit (${settings.family_max_adults} adults and ${settings.family_max_children} children).`,
          },
          { status: 409 },
        );
      const { data: individualMembership, error: individualMembershipError } = await db
        .from('memberships')
        .select('waiver_version,waiver_accepted_at')
        .eq('user_id', user.id)
        .not('waiver_accepted_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (individualMembershipError) throw individualMembershipError;
      const update: Record<string, string | null> = {
        status: 'confirmed',
        joined_at: new Date().toISOString(),
      };
      // Preserve the member's separately recorded acceptance when linking them to a family.
      // Joining an invitation must not itself count as accepting the waiver.
      if (individualMembership?.waiver_accepted_at) {
        update.waiver_version = individualMembership.waiver_version;
        update.waiver_accepted_at = individualMembership.waiver_accepted_at;
      }
      const { error } = await db.from('membership_family_members').update(update).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    if (action === 'accept_waiver') {
      if (me.application_status !== 'approved' || me.account_kind === 'event_guest')
        return NextResponse.json(
          { error: 'An approved member account is required.' },
          { status: 403 },
        );
      if (b.waiverAccepted !== true)
        return NextResponse.json(
          { error: 'Confirm that you accept the current membership waiver.' },
          { status: 400 },
        );
      const { waiver: currentWaiver, response: waiverError } = await loadCurrentWaiver();
      if (waiverError) return waiverError;
      const familyId = String(b.familyId || '');
      const acceptedAt = new Date().toISOString();
      if (familyId) {
        const { data: ownFamilyMember, error: ownFamilyMemberError } = await db
          .from('membership_family_members')
          .update({
            waiver_version: String(currentWaiver.version),
            waiver_accepted_at: acceptedAt,
          })
          .eq('family_id', familyId)
          .eq('user_id', user.id)
          .in('status', ['confirmed', 'pending', 'removed_next_season'])
          .select('id')
          .maybeSingle();
        if (ownFamilyMemberError) throw ownFamilyMemberError;
        if (!ownFamilyMember)
          return NextResponse.json({ error: 'No family membership was found.' }, { status: 404 });
        return NextResponse.json({ success: true, acceptedAt });
      }

      const { startsOn, endsOn } = getMembershipSeason(
        settings ?? DEFAULT_MEMBERSHIP_SEASON_SETTINGS,
      )!;
      const { data: currentMembership, error: membershipReadError } = await db
        .from('memberships')
        .select('id')
        .eq('user_id', user.id)
        .eq('starts_on', startsOn)
        .eq('ends_on', endsOn)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (membershipReadError) throw membershipReadError;
      if (currentMembership) {
        const { error } = await db
          .from('memberships')
          .update({
            waiver_version: String(currentWaiver.version),
            waiver_accepted_at: acceptedAt,
          })
          .eq('id', currentMembership.id)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('memberships').insert({
          user_id: user.id,
          membership_type: 'individual',
          status: 'pending',
          payment_status: 'unpaid',
          starts_on: startsOn,
          ends_on: endsOn,
          waiver_version: String(currentWaiver.version),
          waiver_accepted_at: acceptedAt,
        });
        if (error) throw error;
      }
      return NextResponse.json({ success: true, acceptedAt });
    }
    if (action === 'remove') {
      const familyId = String(b.familyId || '');
      if (!familyId) return NextResponse.json({ error: 'Family ID is required.' }, { status: 400 });
      const { data: membership } = await db
        .from('membership_family_members')
        .select('id,family_id,membership_families(paid_at,season_year)')
        .eq('family_id', familyId)
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .maybeSingle();
      if (!membership)
        return NextResponse.json({ error: 'You are not in a family.' }, { status: 404 });
      const familyRelation = (
        membership as {
          membership_families:
            | { paid_at: string | null; season_year: number }
            | { paid_at: string | null; season_year: number }[]
            | null;
        }
      ).membership_families;
      const fam = Array.isArray(familyRelation) ? familyRelation[0] : familyRelation;
      const currentYear = new Date().getFullYear();
      const paid = Boolean(fam?.paid_at && fam.season_year === currentYear);
      const { error } = await db
        .from('membership_family_members')
        .update({ status: paid ? 'removed_next_season' : 'declined' })
        .eq('id', membership.id);
      if (error) throw error;
      return NextResponse.json({ success: true, effectiveNextSeason: paid });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected error.' },
      { status: 500 },
    );
  }
}
