#!/usr/bin/env node
/**
 * Creates repeatable PCTC demo data in a Supabase project.
 * Requires all Supabase migrations to be applied and a service-role key.
 * Demo accounts use the reserved .test domain and are safe fake identities.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load local environment files without overwriting variables already exported by the shell.
// This keeps the script runnable with `pnpm seed:demo` or `node scripts/seed-demo-data.mjs`.
function loadEnvFile(filePath) {
  let contents;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), '.env.local'));
loadEnvFile(resolve(process.cwd(), '.env'));

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEMO_PASSWORD = process.env.PCTC_DEMO_PASSWORD || '';
const missing = [];
if (!url) missing.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (!DEMO_PASSWORD) missing.push('PCTC_DEMO_PASSWORD');
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}.`);
  console.error('Set them in .env.local, .env, or your shell before running the demo seed script.');
  process.exit(1);
}
if (!/^https:\/\//.test(url)) {
  console.error('SUPABASE_URL must be a valid https:// Supabase project URL.');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const now = new Date();
const iso = (d) => d.toISOString();
const shiftDays = (date, days) => new Date(date.getTime() + days * 86400000);
const dateOnly = (date) => date.toISOString().slice(0, 10);
const pick = (arr, index) => arr[index % arr.length];
const must = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

const firstNames = [
  'Alex',
  'Jordan',
  'Taylor',
  'Morgan',
  'Casey',
  'Jamie',
  'Riley',
  'Cameron',
  'Avery',
  'Drew',
  'Sam',
  'Robin',
  'Quinn',
  'Parker',
  'Reese',
  'Blake',
  'Hayden',
  'Rowan',
  'Skyler',
  'Finley',
];
const lastNames = [
  'Chen',
  'Patel',
  'Smith',
  'Singh',
  'Brown',
  'Wilson',
  'Martin',
  'Lee',
  'Thompson',
  'Nguyen',
  'Clark',
  'Wong',
  'Anderson',
  'Taylor',
  'Moore',
  'Johnson',
  'White',
  'Scott',
  'Green',
  'Adams',
];
const skillLevels = ['2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0'];

function makePeople() {
  const people = [];
  for (let i = 0; i < 100; i++) {
    const n = i + 1;
    const admin = i === 0;
    const memberIndex = i - 1;
    // Each first name is paired with a different last name in every cycle, so all 100 names are unique.
    const fullName = admin
      ? 'PCTC Demo Administrator'
      : `${pick(firstNames, memberIndex)} ${pick(lastNames, Math.floor(memberIndex / firstNames.length) * 7 + (memberIndex % firstNames.length) * 3)}`;
    const email = admin
      ? 'demo.admin@example.com'
      : `demo.member${String(n).padStart(3, '0')}@example.com`;
    const applicationStatus = admin || i < 78 ? 'approved' : i < 94 ? 'pending' : 'dismissed';
    people.push({
      index: i,
      email,
      full_name: fullName,
      phone: `604-555-${String(100 + ((n - 1) % 100)).padStart(4, '0')}`,
      tennis_skill_level: pick(skillLevels, i * 3 + 1),
      date_of_birth: dateOnly(
        new Date(Date.UTC(1965 + ((i * 13) % 42), (i * 5) % 12, 1 + ((i * 7) % 27))),
      ),
      gender: i % 2 === 0 ? 'male' : 'female',
      playing_hand: i % 5 === 0 ? 'left' : 'right',
      application_status: applicationStatus,
      role: admin ? 'admin' : i === 1 ? 'organizer' : 'member',
      application_comment:
        applicationStatus === 'pending'
          ? 'Demo application awaiting review.'
          : applicationStatus === 'dismissed'
            ? 'Demo application not approved.'
            : '',
      email_registration_updates: i % 7 !== 0,
      email_waitlist_updates: i % 9 !== 0,
      email_event_cancellations: true,
      email_registration_reminders: i % 6 !== 0,
      email_new_events: i % 8 !== 0,
      email_newsletter: i % 5 !== 0,
    });
  }
  return people;
}

async function getAllAuthUsers() {
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`List auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function ensureUsers(people) {
  const authUsers = await getAllAuthUsers();
  const byEmail = new Map(authUsers.map((u) => [u.email?.toLowerCase(), u]));
  const ids = new Map();
  let created = 0;
  for (const person of people) {
    let user = byEmail.get(person.email.toLowerCase());
    if (!user) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: person.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: person.full_name,
          phone: person.phone,
          tennis_skill_level: person.tennis_skill_level,
          application_comment: person.application_comment,
        },
      });
      if (error) throw new Error(`Create ${person.email}: ${error.message}`);
      user = data.user;
      created++;
    } else {
      const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: person.full_name,
          phone: person.phone,
          tennis_skill_level: person.tennis_skill_level,
          application_comment: person.application_comment,
        },
      });
      if (error) throw new Error(`Refresh demo account ${person.email}: ${error.message}`);
      user = data.user;
    }
    ids.set(person.email, user.id);
  }
  // The auth trigger creates profiles; upsert also repairs profiles if a previous partial run left one missing.
  const profiles = people.map(({ index, ...p }) => ({
    ...p,
    id: ids.get(p.email),
    email: p.email,
    updated_at: iso(now),
  }));
  for (let i = 0; i < profiles.length; i += 100) {
    must(
      await supabase.from('profiles').upsert(profiles.slice(i, i + 100), { onConflict: 'id' }),
      'Upsert demo profiles',
    );
  }
  return { ids, created };
}

async function deleteIn(table, column, values, label) {
  if (!values?.length) return;
  must(await supabase.from(table).delete().in(column, values), label);
}

// Remove only records owned by earlier runs of this seeder. Demo identities are
// identifiable by their reserved example.com email pattern and demo event slugs.
async function resetPreviousDemoData() {
  console.log('Cleaning up records from previous demo-seeder runs...');
  const authUsers = await getAllAuthUsers();
  const demoUsers = authUsers.filter(
    (user) =>
      user.email === 'demo.admin@example.com' ||
      /^demo\.member\d{3}@example\.com$/i.test(user.email || ''),
  );
  const userIds = demoUsers.map((user) => user.id);

  const demoEvents =
    must(
      await supabase.from('events').select('id').like('slug', 'pctc-demo-%'),
      'Find previous demo events',
    ) || [];
  const eventIds = demoEvents.map((event) => event.id);

  const oldMemberships = userIds.length
    ? must(
        await supabase.from('memberships').select('id').in('user_id', userIds),
        'Find previous demo memberships',
      ) || []
    : [];
  const membershipIds = oldMemberships.map((row) => row.id);

  const oldRegistrations = [];
  if (eventIds.length) {
    oldRegistrations.push(
      ...(must(
        await supabase.from('registrations').select('id').in('event_id', eventIds),
        'Find registrations for previous demo events',
      ) || []),
    );
  }
  if (userIds.length) {
    oldRegistrations.push(
      ...(must(
        await supabase.from('registrations').select('id').in('user_id', userIds),
        'Find registrations for previous demo users',
      ) || []),
    );
  }
  const registrationIds = [...new Set(oldRegistrations.map((row) => row.id))];

  const oldFamilyLinks = userIds.length
    ? must(
        await supabase
          .from('membership_family_members')
          .select('family_id,user_id')
          .in('user_id', userIds),
        'Find previous demo family links',
      ) || []
    : [];
  const oldPaidFamilies = userIds.length
    ? must(
        await supabase.from('membership_families').select('id').in('paid_by', userIds),
        'Find previous demo family groups',
      ) || []
    : [];
  const familyIds = [
    ...new Set([
      ...oldFamilyLinks.map((row) => row.family_id),
      ...oldPaidFamilies.map((row) => row.id),
    ]),
  ];

  // Payments use the current Stripe foundation schema. Do not query legacy columns
  // such as notes, recorded_by, membership_id, or registration_id.
  const demoSeedPayments =
    must(
      await supabase.from('payments').select('id').like('idempotency_key', 'demo-seed:%'),
      'Find previous demo seed payments',
    ) || [];
  const userPayments = userIds.length
    ? must(
        await supabase.from('payments').select('id').in('user_id', userIds),
        'Find payments belonging to previous demo users',
      ) || []
    : [];
  const paymentIds = [...new Set([...demoSeedPayments, ...userPayments].map((row) => row.id))];

  await deleteIn(
    'payment_refunds',
    'payment_id',
    paymentIds,
    'Delete refunds for previous demo payments',
  );
  await deleteIn('payments', 'id', paymentIds, 'Delete previous demo payments');

  // Clean auxiliary records that can otherwise keep demo profiles referenced.
  await deleteIn(
    'event_notification_queue',
    'user_id',
    userIds,
    'Delete previous demo notification queue entries',
  );
  await deleteIn('event_email_log', 'user_id', userIds, 'Delete previous demo email log entries');
  await deleteIn(
    'membership_reminder_log',
    'user_id',
    userIds,
    'Delete previous demo membership reminder records',
  );
  await deleteIn(
    'membership_family_members',
    'family_id',
    familyIds,
    'Delete previous demo family links',
  );
  await deleteIn(
    'membership_family_members',
    'user_id',
    userIds,
    'Delete previous demo family memberships',
  );
  if (userIds.length)
    must(
      await supabase
        .from('membership_family_members')
        .update({ invited_by: null })
        .in('invited_by', userIds),
      'Detach previous demo inviters from other family groups',
    );
  await deleteIn('membership_families', 'id', familyIds, 'Delete previous demo family groups');

  // Remove seed-owned news/events and registrations made by demo identities.
  if (userIds.length) {
    must(
      await supabase.from('news').delete().in('created_by', userIds),
      'Delete news created by previous demo users',
    );
    must(
      await supabase.from('events').update({ created_by: null }).in('created_by', userIds),
      'Detach demo creators from non-demo events',
    );
    // Do not update event_scores here: the score-entry window trigger also rejects
    // metadata-only updates on old events. Seed-owned events are deleted below, which
    // removes their scores without bypassing the database rule.
    must(
      await supabase.from('documents').update({ uploaded_by: null }).in('uploaded_by', userIds),
      'Detach demo uploaders from documents',
    );
    must(
      await supabase.from('waiver_versions').update({ created_by: null }).in('created_by', userIds),
      'Detach demo creators from waiver versions',
    );
    must(
      await supabase
        .from('legal_document_versions')
        .update({ created_by: null })
        .in('created_by', userIds),
      'Detach demo creators from legal documents',
    );
    must(
      await supabase.from('event_series').update({ created_by: null }).in('created_by', userIds),
      'Detach demo creators from event series',
    );
    must(
      await supabase
        .from('membership_plan_settings')
        .update({ updated_by: null })
        .in('updated_by', userIds),
      'Detach demo updater from membership plan settings',
    );
    must(
      await supabase
        .from('member_admin_notes')
        .update({ updated_by: null })
        .in('updated_by', userIds),
      'Detach demo updater from member notes',
    );
    must(
      await supabase
        .from('member_suspensions')
        .update({ created_by: null, cancelled_by: null })
        .or(`created_by.in.(${userIds.join(',')}),cancelled_by.in.(${userIds.join(',')})`),
      'Detach demo actors from suspension history',
    );
  }
  must(
    await supabase.from('news').delete().like('title', '[DEMO] %'),
    'Delete previous demo news posts',
  );
  await deleteIn(
    'registrations',
    'user_id',
    userIds,
    'Delete registrations belonging to previous demo users',
  );
  await deleteIn('events', 'id', eventIds, 'Delete previous demo events');
  await deleteIn('memberships', 'user_id', userIds, 'Delete previous demo memberships');

  // Delete the Auth users last so profile cascades run only after dependent rows are clear.
  for (const user of demoUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Delete previous demo account ${user.email}: ${error.message}`);
  }
  console.log(
    `Removed ${demoUsers.length} prior demo accounts, ${eventIds.length} demo events, and their related seed data.`,
  );
}

function makeEvents(adminId) {
  const items = [];
  const pastTitles = [
    'Saturday Social Doubles',
    'Tuesday Ladder Night',
    'Beginner Skills Clinic',
    'Mixed Doubles Round Robin',
    'Friday Evening Social',
    'Intermediate Drills',
    'Club Ladder Session',
    'Sunday Social Doubles',
    'Serve and Return Clinic',
    'Open Doubles Play',
    'Ladies Social Doubles',
    'Men’s Ladder Night',
    'Weekend Match Play',
    'All-Level Skills Session',
    'Competitive Singles Ladder',
    'Community Tennis Social',
    'Autumn Doubles Mixer',
    'Club Match Practice',
  ];
  // Sixteen past sessions in September keep the dashboard's default Apr-Sep season populated.
  for (let i = 0; i < 16; i++) {
    const day = 2 + Math.floor((i * 27) / 15);
    const start = new Date(Date.UTC(2026, 8, day, i % 2 ? 1 : 2, 0)); // UTC hours render as afternoon/evening in BC.
    items.push({
      slug: `pctc-demo-past-${String(i + 1).padStart(2, '0')}`,
      title: pastTitles[i],
      starts_at: iso(start),
      ends_at: iso(new Date(start.getTime() + 2 * 3600000)),
      event_type: i % 7 === 0 ? 'tournament' : i % 3 === 0 ? 'ladder' : 'social',
      status: 'published',
      capacity: [8, 12, 16, 20][i % 4],
      court_count: [2, 3, 4][i % 3],
      price_cents: i % 4 === 0 ? 1000 : 0,
      registration_opens_at: iso(new Date(start.getTime() - 14 * 86400000)),
      registration_closes_at: iso(start),
      members_only: true,
      waitlist_enabled: true,
      location: 'Port Coquitlam Tennis Club',
      notes: 'Demo data — safe to delete.',
      created_by: adminId,
    });
  }
  // Two recent past sessions can accept scores under the application's two-day score-entry rule.
  // Use relative timestamps rather than fixed UTC hours so both sessions remain within the
  // database trigger's two-day window regardless of the time of day the seeder is run.
  for (let i = 0; i < 2; i++) {
    const start = new Date(now.getTime() - (i + 1) * 6 * 3600000);
    items.push({
      slug: `pctc-demo-recent-past-${i + 1}`,
      title: i === 0 ? 'Recent Social Doubles' : 'Recent Ladder Match',
      starts_at: iso(start),
      ends_at: iso(new Date(start.getTime() + 2 * 3600000)),
      event_type: 'social',
      status: 'published',
      capacity: 16,
      court_count: 4,
      price_cents: 0,
      registration_opens_at: iso(shiftDays(start, -7)),
      registration_closes_at: iso(start),
      members_only: true,
      waitlist_enabled: true,
      location: 'Port Coquitlam Tennis Club',
      notes: 'Demo data — recent session for score-entry testing.',
      created_by: adminId,
    });
  }
  const futureTitles = [
    'Wednesday Ladder Night',
    'Weekend Doubles Social',
    'Autumn Skills Clinic',
    'Mixed Doubles Round Robin',
    'Beginner Coaching Session',
    'Club Tournament Warm-up',
    'Friday Night Tennis',
    'Sunday Match Play',
  ];
  for (let i = 0; i < 8; i++) {
    const start = shiftDays(now, 2 + i * 3);
    start.setUTCHours(18 + (i % 3), 0, 0, 0);
    const opens = i % 3 === 1 ? shiftDays(now, 1 + i) : shiftDays(now, -3);
    items.push({
      slug: `pctc-demo-future-${String(i + 1).padStart(2, '0')}`,
      title: futureTitles[i],
      starts_at: iso(start),
      ends_at: iso(new Date(start.getTime() + 2 * 3600000)),
      event_type: i === 5 ? 'tournament' : i % 2 ? 'ladder' : 'social',
      status: 'published',
      capacity: [8, 12, 16, 20][i % 4],
      court_count: [2, 3, 4][i % 3],
      price_cents: i % 3 === 0 ? 500 : 0,
      registration_opens_at: iso(opens),
      registration_closes_at: iso(new Date(start.getTime() - 2 * 3600000)),
      members_only: true,
      waitlist_enabled: true,
      location: 'Port Coquitlam Tennis Club',
      notes: 'Demo data — safe to delete.',
      created_by: adminId,
    });
  }
  return items;
}

async function main() {
  console.log(`Seeding demo data into ${url}`);
  await resetPreviousDemoData();
  const people = makePeople();
  const { ids, created } = await ensureUsers(people);
  const adminId = ids.get('demo.admin@example.com');
  console.log(
    `Auth accounts: ${people.length} demo accounts (${created} newly created). Admin: demo.admin@example.com`,
  );

  // Memberships: mix of single/family, paid/unpaid and all lifecycle states.
  const membershipRows = [];
  for (const p of people) {
    const id = ids.get(p.email);
    let status;
    if (p.index === 0 || (p.application_status === 'approved' && p.index % 5 !== 0))
      status = 'active';
    else if (p.index % 4 === 0) status = 'expired';
    else if (p.index % 4 === 1) status = 'pending';
    else if (p.index % 4 === 2) status = 'suspended';
    else status = 'active';
    const paid = status === 'active' && p.application_status === 'approved' && p.index % 4 !== 0;
    const starts =
      status === 'expired' ? dateOnly(shiftDays(now, -400)) : dateOnly(shiftDays(now, -30));
    const ends =
      status === 'expired'
        ? dateOnly(shiftDays(now, -10))
        : status === 'active'
          ? '2027-09-30'
          : dateOnly(shiftDays(now, 45));
    membershipRows.push({
      user_id: id,
      membership_type: p.index < 30 || p.index % 6 === 0 || p.index % 6 === 1 ? 'family' : 'single',
      status,
      starts_on: starts,
      ends_on: ends,
      renewal_enabled: p.index % 3 !== 0,
      payment_status: paid ? 'paid' : 'unpaid',
      waiver_version: p.index % 3 === 0 ? null : '2026-demo',
      waiver_accepted_at: p.index % 3 === 0 ? null : iso(shiftDays(now, -20)),
      created_at: iso(shiftDays(now, -(p.index % 300))),
    });
  }
  const insertedMemberships = [];
  for (let i = 0; i < membershipRows.length; i += 100)
    insertedMemberships.push(
      ...must(
        await supabase
          .from('memberships')
          .insert(membershipRows.slice(i, i + 100))
          .select('id,user_id,status,payment_status'),
        'Insert demo memberships',
      ),
    );
  const paidMemberships = insertedMemberships.filter((m) => m.payment_status === 'paid');
  const paymentRows = paidMemberships.map((m, i) => {
    const paidAt = iso(shiftDays(now, -(i % 100)));
    return {
      user_id: m.user_id,
      purpose: 'membership',
      business_record_id: m.id,
      amount_minor: i % 2 === 0 ? 15000 : 22000,
      currency: 'cad',
      status: 'succeeded',
      idempotency_key: `demo-seed:membership:${m.id}`,
      created_at: paidAt,
      updated_at: paidAt,
      succeeded_at: paidAt,
    };
  });
  for (let i = 0; i < paymentRows.length; i += 100)
    must(
      await supabase.from('payments').insert(paymentRows.slice(i, i + 100)),
      'Insert demo membership payments',
    );

  // Ten family groups make family membership screens and cross-references testable too.
  const familyRows = [];
  for (let groupIndex = 0; groupIndex < 10; groupIndex++) {
    const isPaid = groupIndex % 3 !== 1;
    const family = must(
      await supabase
        .from('membership_families')
        .insert({
          season_year: 2026,
          paid_at: isPaid ? iso(shiftDays(now, -20 - groupIndex)) : null,
          paid_by: isPaid ? adminId : null,
        })
        .select('id')
        .single(),
      'Create demo family',
    );
    const members = [0, 1, 2].map((offset) => groupIndex * 3 + offset);
    familyRows.push(
      ...members.map((personIndex, memberIndex) => ({
        family_id: family.id,
        user_id: ids.get(people[personIndex].email),
        invited_by: ids.get(people[members[0]].email),
        status: memberIndex === 2 && groupIndex % 3 === 2 ? 'pending' : 'confirmed',
        joined_at:
          memberIndex === 2 && groupIndex % 3 === 2 ? null : iso(shiftDays(now, -10 - groupIndex)),
      })),
    );
  }
  must(
    await supabase.from('membership_family_members').insert(familyRows),
    'Insert demo family members',
  );

  // Plan defaults make membership management screens meaningful in an empty project.
  must(
    await supabase.from('membership_plan_settings').upsert(
      {
        id: 1,
        single_price_cents: 15000,
        family_price_cents: 22000,
        family_max_adults: 2,
        family_max_children: 4,
        season_start_month: 4,
        season_start_day: 1,
        season_end_month: 9,
        season_end_day: 30,
        updated_by: adminId,
        updated_at: iso(now),
      },
      { onConflict: 'id' },
    ),
    'Set demo membership plan settings',
  );

  const eventRows = makeEvents(adminId);
  const insertedEvents = [];
  for (let i = 0; i < eventRows.length; i += 100)
    insertedEvents.push(
      ...must(
        await supabase
          .from('events')
          .insert(eventRows.slice(i, i + 100))
          .select('*'),
        'Insert demo events',
      ),
    );
  const approvedPaid = people
    .filter(
      (p) =>
        p.application_status === 'approved' &&
        (p.index === 0 || (p.index % 5 !== 0 && p.index % 4 !== 0)),
    )
    .map((p) => ids.get(p.email));
  const approvedAny = people
    .filter((p) => p.application_status === 'approved')
    .map((p) => ids.get(p.email));
  const registrationsByEvent = new Map();
  const regRows = [];
  for (const event of insertedEvents) {
    const isPast = new Date(event.starts_at) < now;
    const registrationOpen = new Date(event.registration_opens_at) <= now;
    // Do not fabricate registrations for future sessions whose registration window has not opened.
    if (!isPast && !registrationOpen) continue;
    const pool = isPast ? approvedAny : approvedPaid;
    const desired = isPast
      ? Math.min(event.capacity + (event.id.charCodeAt(0) % 5), 18)
      : Math.min(event.capacity + (event.id.charCodeAt(1) % 4), 18);
    const chosen = pool
      .filter((_, index) => (index + event.slug.length * 3) % 3 !== 1)
      .slice(0, desired);
    const seen = new Set();
    let confirmed = 0;
    let waitlisted = 0;
    const confirmedLimit = event.capacity;
    chosen.forEach((userId, j) => {
      if (seen.has(userId)) return;
      seen.add(userId);
      const cancelled = j > 0 && j % 17 === 0;
      const status = cancelled
        ? 'cancelled'
        : confirmed < confirmedLimit
          ? 'confirmed'
          : 'waitlisted';
      if (status === 'confirmed') confirmed++;
      if (status === 'waitlisted') waitlisted++;
      const registrationDate = isPast
        ? new Date(new Date(event.starts_at).getTime() - (3 + j) * 3600000)
        : new Date(
            Math.min(
              now.getTime() - 3600000,
              new Date(event.starts_at).getTime() - (j + 1) * 3600000,
            ),
          );
      regRows.push({
        event_id: event.id,
        user_id: userId,
        status,
        queue_position: status === 'waitlisted' ? waitlisted : null,
        payment_status:
          event.price_cents === 0
            ? 'not_required'
            : status === 'confirmed'
              ? j % 3 === 0
                ? 'paid'
                : 'pending'
              : 'pending',
        amount_cents: event.price_cents,
        created_at: iso(registrationDate),
        updated_at: iso(registrationDate),
      });
    });
  }
  const registrations = [];
  for (let i = 0; i < regRows.length; i += 200)
    registrations.push(
      ...must(
        await supabase
          .from('registrations')
          .insert(regRows.slice(i, i + 200))
          .select('id,event_id,user_id,status,queue_position'),
        'Insert demo registrations',
      ),
    );
  for (const r of registrations) {
    if (!registrationsByEvent.has(r.event_id)) registrationsByEvent.set(r.event_id, []);
    registrationsByEvent.get(r.event_id).push(r);
  }

  // Assign confirmed registrations to courts. Every assignment's event matches its registration's event.
  const courtRows = [];
  for (const event of insertedEvents) {
    const confirmed = (registrationsByEvent.get(event.id) || []).filter(
      (r) => r.status === 'confirmed',
    );
    confirmed.forEach((r, i) =>
      courtRows.push({
        event_id: event.id,
        registration_id: r.id,
        court_number: 1 + (Math.floor(i / 4) % event.court_count),
        segment_order: 1 + Math.floor(i / (event.court_count * 4)),
      }),
    );
  }
  for (let i = 0; i < courtRows.length; i += 200)
    must(
      await supabase.from('event_court_assignments').insert(courtRows.slice(i, i + 200)),
      'Insert demo court assignments',
    );

  // The database enforces that scores may only be entered within two days of the event.
  // Seed scores only for the two deliberately recent past sessions; never attempt to insert
  // scores for the older historical demo sessions. The trigger stays enabled throughout.
  const scoreRows = [];
  const scoreCutoff = now.getTime() - 2 * 86400000;
  const scoreEligibleEvents = insertedEvents.filter((event) => {
    const startsAt = new Date(event.starts_at).getTime();
    return startsAt < now.getTime() && startsAt >= scoreCutoff && event.event_type !== 'tournament';
  });
  for (const event of scoreEligibleEvents) {
    const confirmed = (registrationsByEvent.get(event.id) || []).filter(
      (r) => r.status === 'confirmed',
    );
    // Use doubles teams of four distinct confirmed registrations per score row.
    for (let i = 0; i + 3 < Math.min(confirmed.length, 8); i += 4) {
      scoreRows.push({
        event_id: event.id,
        player_one_registration_id: confirmed[i].id,
        player_two_registration_id: confirmed[i + 1].id,
        player_three_registration_id: confirmed[i + 2].id,
        player_four_registration_id: confirmed[i + 3].id,
        player_one_score: i % 8 === 0 ? 6 : 4,
        player_two_score: i % 8 === 0 ? 3 : 6,
        played_at: iso(new Date(new Date(event.starts_at).getTime() + 45 * 60000)),
        entered_by: adminId,
      });
    }
  }
  if (scoreRows.length)
    must(await supabase.from('event_scores').insert(scoreRows), 'Insert demo scores');

  const news = [
    [
      'Welcome to the PCTC member portal',
      'Welcome to the Port Coquitlam Tennis Club member portal. Update your profile, review your membership, and register for upcoming club sessions from one place.',
    ],
    [
      'Autumn doubles social',
      'Join fellow club members for a relaxed doubles session. Players will rotate partners and courts so everyone gets a chance to play.',
    ],
    [
      'Court etiquette reminder',
      'Please arrive on time, share courts fairly, and leave the playing area tidy. If you cannot attend a session, cancel your registration early so a waitlisted player can take the spot.',
    ],
    [
      'Membership renewals are approaching',
      'Planning for the 2027 season is underway. Membership renewal dates, fees, and payment instructions will be shared with members before registration opens.',
    ],
    [
      'Volunteers needed for upcoming club events',
      'We are looking for volunteers to help with social sessions, ladders, and beginner-friendly club activities. Contact the club team if you would like to help.',
    ],
  ].map(([title, body], i) => ({
    title,
    body,
    published: true,
    published_at: iso(shiftDays(now, -i * 3)),
    created_by: adminId,
    created_at: iso(shiftDays(now, -i * 3)),
    updated_at: iso(now),
  }));
  must(await supabase.from('news').insert(news), 'Insert demo news');

  // Keep the club name/settings intact; only ensure the singleton settings row exists.
  console.log('\nDemo seed complete.');
  console.log(`- ${people.length} demo auth users and profiles`);
  console.log(
    `- ${insertedMemberships.length} memberships (${paidMemberships.length} paid); 10 family groups / ${familyRows.length} family-member links`,
  );
  console.log(`- ${insertedEvents.length} published sessions: 18 past, 8 future`);
  console.log(
    `- ${registrations.length} registrations; ${courtRows.length} court assignments; ${scoreRows.length} scores across ${scoreEligibleEvents.length} past non-tournament sessions`,
  );
  console.log(`- ${news.length} published news posts`);
  console.log(`Admin login: demo.admin@example.com / ${DEMO_PASSWORD}`);
  console.log(`Member login example: demo.member002@example.com / ${DEMO_PASSWORD}`);
  console.log(
    'Demo events use the pctc-demo- slug prefix; demo news is removed by its demo creator on the next reset.',
  );
}

main().catch((error) => {
  console.error('\nDemo seed failed:', error.message || error);
  process.exit(1);
});
