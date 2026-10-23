import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const url = process.env.PCTC_E2E_SUPABASE_URL;
const anonKey = process.env.PCTC_E2E_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.PCTC_E2E_SUPABASE_SERVICE_ROLE_KEY;
const password = randomBytes(24).toString('base64url');
const writesEnabled =
  process.env.PCTC_E2E_DISPOSABLE_DATABASE === 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION';

type TestUser = { id: string; client: SupabaseClient };

test('serializes concurrent registrations at capacity and promotes waitlist on withdrawal', async () => {
  test.skip(
    !url || !anonKey || !serviceRoleKey || !writesEnabled,
    'Requires PCTC_E2E_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY and explicit confirmation for a disposable database.',
  );
  test.setTimeout(120_000);

  const admin = createClient(url!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const clients: TestUser[] = [];
  const createdUserIds: string[] = [];
  let eventId: string | null = null;

  try {
    const runId = randomUUID();
    const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const registrationClosesAt = new Date(startsAt.getTime() - 60 * 60 * 1000);
    const registrationOpensAt = new Date(Date.now() - 60 * 60 * 1000);
    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        title: `E2E capacity invariant ${runId}`,
        slug: `e2e-capacity-${runId}`,
        description: 'Disposable database concurrency fixture',
        event_type: 'social',
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        registration_opens_at: registrationOpensAt.toISOString(),
        registration_closes_at: registrationClosesAt.toISOString(),
        capacity: 16,
        price_cents: 0,
        members_only: false,
        waitlist_enabled: true,
        status: 'published',
      })
      .select('id')
      .single();
    if (eventError) throw eventError;
    eventId = event.id;

    for (let index = 0; index < 20; index++) {
      const email = `e2e-${runId}-${index}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: `E2E Participant ${index}`,
          phone: '604.555.0199',
          tennis_skill_level: '3.5',
        },
      });
      if (error) throw error;
      const userId = data.user.id;
      createdUserIds.push(userId);
      const { error: approvalError } = await admin
        .from('profiles')
        .update({ application_status: 'approved' })
        .eq('id', userId);
      if (approvalError) throw approvalError;
      const client = createClient(url!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      clients.push({ id: userId, client });
    }

    const simultaneous = await Promise.all(
      clients.map(({ client }) =>
        client.rpc('register_for_event', {
          p_event_id: eventId,
          p_idempotency_key: randomUUID(),
        }),
      ),
    );
    expect(simultaneous.filter(({ error }) => !error)).toHaveLength(20);

    const readRegistrations = async () => {
      const { data, error } = await admin
        .from('registrations')
        .select('id,user_id,status,queue_position')
        .eq('event_id', eventId);
      if (error) throw error;
      return data ?? [];
    };
    let registrations = await readRegistrations();
    expect(registrations.filter((row) => row.status === 'confirmed')).toHaveLength(16);
    expect(registrations.filter((row) => row.status === 'waitlisted')).toHaveLength(4);
    expect(new Set(registrations.map((row) => row.user_id)).size).toBe(20);
    expect(
      registrations
        .filter((row) => row.status === 'waitlisted')
        .map((row) => row.queue_position)
        .sort(),
    ).toEqual([1, 2, 3, 4]);

    const readAudit = async (action: string) => {
      const { data, error } = await admin
        .from('audit_logs')
        .select('id,action,target_record_id,idempotency_key')
        .eq('event_id', eventId)
        .eq('action', action);
      if (error) throw error;
      return data ?? [];
    };
    const registrationAudit = await readAudit('event.registration.created');
    expect(registrationAudit).toHaveLength(20);
    expect(new Set(registrationAudit.map((row) => row.target_record_id)).size).toBe(20);
    expect(new Set(registrationAudit.map((row) => row.idempotency_key)).size).toBe(20);

    const alreadyRegistered = clients[0];
    const duplicateRequests = await Promise.all([
      alreadyRegistered.client.rpc('register_for_event', {
        p_event_id: eventId,
        p_idempotency_key: randomUUID(),
      }),
      alreadyRegistered.client.rpc('register_for_event', {
        p_event_id: eventId,
        p_idempotency_key: randomUUID(),
      }),
    ]);
    expect(duplicateRequests.every(({ error }) => Boolean(error))).toBe(true);
    expect(await readAudit('event.registration.created')).toHaveLength(20);

    const firstConfirmed = registrations.find((row) => row.status === 'confirmed');
    const firstClient = clients.find((user) => user.id === firstConfirmed?.user_id);
    expect(firstConfirmed).toBeDefined();
    expect(firstClient).toBeDefined();
    const withdrawal = await firstClient!.client.rpc('withdraw_from_event', {
      p_registration_id: firstConfirmed!.id,
      p_idempotency_key: randomUUID(),
    });
    expect(withdrawal.error).toBeNull();

    registrations = await readRegistrations();
    expect(registrations.filter((row) => row.status === 'confirmed')).toHaveLength(16);
    expect(registrations.filter((row) => row.status === 'waitlisted')).toHaveLength(3);
    expect(registrations.filter((row) => row.status === 'cancelled')).toHaveLength(1);
    expect(await readAudit('event.registration.withdrawn')).toHaveLength(1);

    const nextConfirmed = registrations.find((row) => row.status === 'confirmed');
    const nextClient = clients.find((user) => user.id === nextConfirmed?.user_id);
    const newParticipant = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const newEmail = `e2e-${runId}-late@example.test`;
    const { data: lateUser, error: lateCreateError } = await admin.auth.admin.createUser({
      email: newEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'E2E Late Participant',
        phone: '604.555.0198',
        tennis_skill_level: '3.0',
      },
    });
    if (lateCreateError) throw lateCreateError;
    createdUserIds.push(lateUser.user.id);
    const { error: lateApprovalError } = await admin
      .from('profiles')
      .update({ application_status: 'approved' })
      .eq('id', lateUser.user.id);
    if (lateApprovalError) throw lateApprovalError;
    clients.push({ id: lateUser.user.id, client: newParticipant });
    const { error: lateSignInError } = await newParticipant.auth.signInWithPassword({
      email: newEmail,
      password,
    });
    if (lateSignInError) throw lateSignInError;

    const [concurrentWithdrawal, concurrentRegistration] = await Promise.all([
      nextClient!.client.rpc('withdraw_from_event', {
        p_registration_id: nextConfirmed!.id,
        p_idempotency_key: randomUUID(),
      }),
      newParticipant.rpc('register_for_event', {
        p_event_id: eventId,
        p_idempotency_key: randomUUID(),
      }),
    ]);
    expect(concurrentWithdrawal.error).toBeNull();
    expect(concurrentRegistration.error).toBeNull();
    registrations = await readRegistrations();
    expect(registrations.filter((row) => row.status === 'confirmed')).toHaveLength(16);
    const remainingWaitlist = registrations.filter((row) => row.status === 'waitlisted');
    expect(remainingWaitlist).toHaveLength(3);
    expect(remainingWaitlist.map((row) => row.queue_position).sort()).toEqual([1, 2, 3]);
    expect(new Set(registrations.map((row) => row.user_id)).size).toBe(registrations.length);
    expect(await readAudit('event.registration.withdrawn')).toHaveLength(2);
  } finally {
    if (eventId) {
      await admin.from('audit_logs').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('id', eventId);
    }
    for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId);
  }
});
