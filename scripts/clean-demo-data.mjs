#!/usr/bin/env node
/**
 * Removes records owned by scripts/seed-demo-data.mjs from a Supabase project.
 * Dry run is the default. Applying changes requires an explicit project-ref match.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function help() {
  console.log(`Usage:
  pnpm clean:demo                         Show what would be removed
  pnpm clean:demo -- --apply --confirm-project-ref <project-ref>

The project ref is the subdomain in the Supabase URL. The command removes only
demo accounts (demo.admin@example.com and demo.member###@example.com) and data
owned by those accounts or events whose slug starts with pctc-demo-.
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  help();
  process.exit(0);
}

loadEnvFile(resolve(process.cwd(), '.env.local'));
loadEnvFile(resolve(process.cwd(), '.env'));

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

let projectRef;
try {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
    throw new Error('expected an https://<project-ref>.supabase.co URL');
  }
  projectRef = parsed.hostname.split('.')[0];
} catch (error) {
  console.error(`Invalid Supabase URL: ${error.message}`);
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const confirmIndex = process.argv.indexOf('--confirm-project-ref');
const confirmedRef = confirmIndex >= 0 ? process.argv[confirmIndex + 1] : undefined;
if (apply && confirmedRef !== projectRef) {
  console.error(
    `Refusing to delete data. To apply, pass --confirm-project-ref ${projectRef} for this configured project.`,
  );
  process.exit(1);
}
if (!apply && confirmedRef) {
  console.error('--confirm-project-ref is only valid together with --apply.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const must = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const chunks = (values, size = 200) => {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
};

async function getDemoUsers() {
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`List Auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users.filter(
    (user) =>
      user.email?.toLowerCase() === 'demo.admin@example.com' ||
      /^demo\.member\d{3}@example\.com$/i.test(user.email || ''),
  );
}

async function rows(table, columns, query = () => {}) {
  return must(query(supabase.from(table).select(columns)), `Find ${table}`) || [];
}

async function deleteIn(table, column, values, label) {
  for (const batch of chunks(values || [])) {
    must(await supabase.from(table).delete().in(column, batch), label);
  }
}

async function inventory() {
  const demoUsers = await getDemoUsers();
  const userIds = demoUsers.map((user) => user.id);
  const events = await rows('events', 'id,slug', (q) => q.like('slug', 'pctc-demo-%'));
  const eventIds = events.map((event) => event.id);
  const memberships = userIds.length
    ? await rows('memberships', 'id,user_id', (q) => q.in('user_id', userIds))
    : [];

  const registrations = [];
  if (eventIds.length)
    registrations.push(...(await rows('registrations', 'id', (q) => q.in('event_id', eventIds))));
  if (userIds.length)
    registrations.push(...(await rows('registrations', 'id', (q) => q.in('user_id', userIds))));

  const familyLinks = userIds.length
    ? await rows('membership_family_members', 'family_id,user_id', (q) => q.in('user_id', userIds))
    : [];
  const paidFamilies = userIds.length
    ? await rows('membership_families', 'id,paid_by', (q) => q.in('paid_by', userIds))
    : [];
  const familyIds = [
    ...new Set([...familyLinks, ...paidFamilies].map((row) => row.family_id || row.id)),
  ];
  // Only remove a family group when all of its linked members are demo accounts.
  const familyRows = familyIds.length
    ? await rows('membership_family_members', 'family_id,user_id', (q) =>
        q.in('family_id', familyIds),
      )
    : [];
  const removableFamilyIds = familyIds.filter(
    (id) =>
      familyRows.some((row) => row.family_id === id) &&
      familyRows
        .filter((row) => row.family_id === id)
        .every((row) => userIds.includes(row.user_id)),
  );

  const seedPayments = await rows('payments', 'id', (q) =>
    q.like('idempotency_key', 'demo-seed:%'),
  );
  const userPayments = userIds.length
    ? await rows('payments', 'id', (q) => q.in('user_id', userIds))
    : [];
  const paymentIds = [...new Set([...seedPayments, ...userPayments].map((row) => row.id))];
  const news = userIds.length ? await rows('news', 'id', (q) => q.in('created_by', userIds)) : [];
  const legacyDemoNews = await rows('news', 'id', (q) => q.like('title', '[DEMO] %'));
  const notificationQueue = userIds.length
    ? await rows('event_notification_queue', 'id', (q) => q.in('user_id', userIds))
    : [];
  const emailLogs = userIds.length
    ? await rows('event_email_log', 'id', (q) => q.in('user_id', userIds))
    : [];
  const reminders = userIds.length
    ? await rows('membership_reminder_log', 'id', (q) => q.in('user_id', userIds))
    : [];

  return {
    demoUsers,
    userIds,
    events,
    eventIds,
    memberships,
    registrations: [...new Set(registrations.map((row) => row.id))],
    familyLinks,
    removableFamilyIds,
    paymentIds,
    newsIds: [...new Set([...news, ...legacyDemoNews].map((row) => row.id))],
    notificationQueue,
    emailLogs,
    reminders,
  };
}

function printInventory(data) {
  console.log(`Supabase project: ${projectRef} (${url})`);
  console.log(`Demo Auth accounts: ${data.demoUsers.length}`);
  console.log(`Demo events (pctc-demo-*): ${data.events.length}`);
  console.log(`Membership records: ${data.memberships.length}`);
  console.log(`Registrations tied to demo users/events: ${data.registrations.length}`);
  console.log(`Payments/refunds tied to demo seed/users: ${data.paymentIds.length} payments`);
  console.log(`Demo-authored/marked news: ${data.newsIds.length}`);
  console.log(`Demo-only family groups: ${data.removableFamilyIds.length}`);
  console.log(
    `Related notification/email/reminder rows: ${data.notificationQueue.length + data.emailLogs.length + data.reminders.length}`,
  );
  if (!apply) {
    console.log(
      '\nDry run only. No records were changed. Add --apply and the exact project ref to delete.',
    );
  }
}

async function clean(data) {
  const { userIds, eventIds, removableFamilyIds, paymentIds } = data;
  await deleteIn('payment_refunds', 'payment_id', paymentIds, 'Delete demo payment refunds');
  await deleteIn('payments', 'id', paymentIds, 'Delete demo payments');
  await deleteIn(
    'event_notification_queue',
    'user_id',
    userIds,
    'Delete demo notification queue rows',
  );
  await deleteIn('event_email_log', 'user_id', userIds, 'Delete demo event email logs');
  await deleteIn(
    'membership_reminder_log',
    'user_id',
    userIds,
    'Delete demo membership reminder rows',
  );
  await deleteIn(
    'membership_family_members',
    'user_id',
    userIds,
    'Delete demo family member links',
  );
  await deleteIn(
    'membership_family_members',
    'family_id',
    removableFamilyIds,
    'Delete demo family links',
  );
  await deleteIn('membership_families', 'id', removableFamilyIds, 'Delete demo family groups');

  if (userIds.length) {
    must(
      await supabase
        .from('membership_family_members')
        .update({ invited_by: null })
        .in('invited_by', userIds),
      'Detach demo inviters from retained family groups',
    );
    await deleteIn('news', 'id', data.newsIds, 'Delete demo-authored/marked news');
    must(
      await supabase.from('events').update({ created_by: null }).in('created_by', userIds),
      'Detach demo creators from retained events',
    );
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
      'Detach demo creators from legal document versions',
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
  if (!userIds.length) await deleteIn('news', 'id', data.newsIds, 'Delete legacy marked demo news');

  await deleteIn('registrations', 'event_id', eventIds, 'Delete registrations for demo events');
  await deleteIn('registrations', 'user_id', userIds, 'Delete registrations owned by demo users');
  await deleteIn('events', 'id', eventIds, 'Delete demo events and dependent event data');
  await deleteIn('memberships', 'user_id', userIds, 'Delete demo memberships');

  for (const user of data.demoUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Delete demo Auth account ${user.email}: ${error.message}`);
  }
  console.log(`\nDeleted ${data.demoUsers.length} demo Auth accounts and associated demo data.`);
}

try {
  const data = await inventory();
  printInventory(data);
  if (apply) await clean(data);
} catch (error) {
  console.error(`\nDemo cleanup failed: ${error.message || error}`);
  process.exit(1);
}
