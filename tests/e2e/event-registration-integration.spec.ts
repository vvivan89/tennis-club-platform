import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const url = process.env.PCTC_E2E_SUPABASE_URL;
const anonKey = process.env.PCTC_E2E_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.PCTC_E2E_SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = randomBytes(24).toString('base64url');
const disposableDatabaseConfirmed =
  process.env.PCTC_E2E_DISPOSABLE_DATABASE === 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION' &&
  Boolean(url) &&
  url === appUrl;

type TestUser = { id: string; email: string; client: SupabaseClient };

test('browser registration fills the only place, waitlists the next member, then promotes on withdrawal', async ({
  browser,
}) => {
  test.skip(
    !url || !anonKey || !serviceRoleKey || !disposableDatabaseConfirmed,
    'Requires a matching app/test URL and explicit confirmation for a disposable Supabase database.',
  );
  test.setTimeout(120_000);

  const admin = createClient(url!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let eventId: string | null = null;
  let contextOne: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let contextTwo: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    const runId = randomUUID();
    const first = await createApprovedMember(admin, anonKey!, runId, 1, password, createdUserIds);
    const second = await createApprovedMember(admin, anonKey!, runId, 2, password, createdUserIds);
    const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        title: `E2E registration ${runId}`,
        slug: `e2e-registration-${runId}`,
        description: 'Disposable browser registration fixture',
        event_type: 'social',
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        registration_opens_at: new Date(Date.now() - 60_000).toISOString(),
        registration_closes_at: new Date(startsAt.getTime() - 60 * 60 * 1000).toISOString(),
        capacity: 1,
        price_cents: 0,
        members_only: false,
        waitlist_enabled: true,
        court_count: 1,
        location: 'Test court',
        status: 'published',
        created_by: first.id,
      })
      .select('id,slug')
      .single();
    if (eventError) throw eventError;
    eventId = event.id;

    contextOne = await browser.newContext();
    contextTwo = await browser.newContext();
    const pageOne = await contextOne.newPage();
    const pageTwo = await contextTwo.newPage();
    await signIn(pageOne, first);
    await signIn(pageTwo, second);

    await pageOne.goto(`/events/${event.slug}`);
    await expect(pageOne.getByRole('heading', { name: `E2E registration ${runId}` })).toBeVisible();
    await pageOne.getByRole('button', { name: 'Register' }).click();
    await expect(pageOne.getByRole('status')).toContainText('Registration confirmed.');

    await pageTwo.goto(`/events/${event.slug}`);
    await pageTwo.getByRole('button', { name: 'Register' }).click();
    await expect(pageTwo.getByRole('status')).toContainText('Added to the waitlist at position 1.');

    let registrations = await readEventRegistrations(admin, eventId!);
    expect(registrations.filter((row) => row.status === 'confirmed')).toHaveLength(1);
    expect(registrations.filter((row) => row.status === 'waitlisted')).toHaveLength(1);
    expect(registrations.find((row) => row.user_id === second.id)?.queue_position).toBe(1);

    await pageOne.getByRole('button', { name: 'Withdraw' }).click();
    await pageOne.getByRole('button', { name: 'Confirm withdrawal' }).click();
    await expect(pageOne.getByRole('status')).toContainText('Registration withdrawn.');

    registrations = await readEventRegistrations(admin, eventId!);
    expect(registrations.filter((row) => row.status === 'confirmed')).toHaveLength(1);
    expect(registrations.filter((row) => row.status === 'waitlisted')).toHaveLength(0);
    expect(registrations.find((row) => row.user_id === first.id)?.status).toBe('cancelled');
    expect(registrations.find((row) => row.user_id === second.id)?.status).toBe('confirmed');

    const { data: registrationAudit, error: auditError } = await admin
      .from('audit_logs')
      .select('action,target_record_id,idempotency_key')
      .eq('event_id', eventId)
      .in('action', ['event.registration.created', 'event.registration.withdrawn']);
    if (auditError) throw auditError;
    expect(registrationAudit).toHaveLength(3);
    expect(
      registrationAudit.filter((row) => row.action === 'event.registration.created'),
    ).toHaveLength(2);
    expect(
      registrationAudit.filter((row) => row.action === 'event.registration.withdrawn'),
    ).toHaveLength(1);
    expect(new Set(registrationAudit.map((row) => row.idempotency_key)).size).toBe(3);
  } finally {
    await contextOne?.close();
    await contextTwo?.close();
    if (eventId) {
      await admin.from('audit_logs').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('id', eventId);
    }
    for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId);
  }
});

async function createApprovedMember(
  admin: SupabaseClient,
  anonKey: string,
  runId: string,
  index: number,
  password: string,
  createdUserIds: string[],
): Promise<TestUser> {
  const email = `e2e-registration-${runId}-${index}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `E2E Registration Member ${index}`,
      phone: '604.555.0187',
      tennis_skill_level: '3.5',
    },
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const { error: approvalError } = await admin
    .from('profiles')
    .update({ application_status: 'approved' })
    .eq('id', data.user.id);
  if (approvalError) throw approvalError;

  const client = createClient(url!, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

async function signIn(page: Page, user: TestUser) {
  await page.goto(`/login?next=${encodeURIComponent('/')}`);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function readEventRegistrations(
  admin: SupabaseClient,
  eventId: string,
): Promise<Array<{ id: string; user_id: string; status: string; queue_position: number | null }>> {
  const { data, error } = await admin
    .from('registrations')
    .select('id,user_id,status,queue_position')
    .eq('event_id', eventId);
  if (error) throw error;
  return data ?? [];
}
