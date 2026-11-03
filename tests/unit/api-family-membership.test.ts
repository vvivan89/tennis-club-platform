import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'owner-1' } as null | { id: string },
  responses: {} as Record<string, unknown[]>,
  calls: [] as Array<{ table: string; operation: string; values?: unknown }>,
  createClient: vi.fn(),
  fetch: vi.fn(),
}));

function nextResult(table: string, method: string) {
  const queue = mocks.responses[`${table}.${method}`] ?? [];
  const value = queue.length
    ? queue.shift()
    : method === 'maybeSingle' || method === 'single'
      ? null
      : [];
  return value && typeof value === 'object' && 'data' in value
    ? value
    : { data: value, error: null };
}

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { GET, POST } from '@/app/api/membership/family/route';

function serviceClient() {
  return {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    from: (table: string) => {
      let operation = 'select';
      let values: unknown;
      const query = {
        select: () => query,
        eq: () => query,
        neq: () => query,
        not: () => query,
        in: () => query,
        or: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => nextResult(table, 'maybeSingle'),
        single: async () => nextResult(table, 'single'),
        insert: (payload: unknown) => {
          operation = 'insert';
          values = payload;
          mocks.calls.push({ table, operation, values });
          return query;
        },
        update: (payload: unknown) => {
          operation = 'update';
          values = payload;
          mocks.calls.push({ table, operation, values });
          return query;
        },
        delete: () => {
          operation = 'delete';
          mocks.calls.push({ table, operation });
          return query;
        },
        then: (
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(nextResult(table, operation) as { data: unknown; error: unknown }).then(
            resolve,
            reject,
          ),
      };
      return query;
    },
  };
}

function request(body: unknown) {
  return new Request('https://club.example/api/membership/family', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const owner = {
  id: 'owner-1',
  full_name: 'Owner Member',
  email: 'owner@example.com',
  application_status: 'approved',
  date_of_birth: '1980-01-01',
};
const target = {
  id: 'target-1',
  full_name: 'Target Member',
  email: 'target@example.com',
  application_status: 'approved',
  date_of_birth: '1985-02-02',
};
const settings = {
  family_max_adults: 2,
  family_max_children: 2,
  season_start_month: 4,
  season_start_day: 1,
  season_end_month: 9,
  season_end_day: 30,
};

beforeEach(() => {
  mocks.user = { id: 'owner-1' };
  mocks.responses = {};
  mocks.calls = [];
  mocks.createClient.mockImplementation(serviceClient);
  mocks.fetch.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('RESEND_FROM_EMAIL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('membership family API', () => {
  it('requires authentication for family reads and writes', async () => {
    mocks.user = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(request({ action: 'invite' }))).status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('returns an empty family view for an authenticated member with no family', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_family_members.select'] = [[], [], [], []];
    mocks.responses['membership_plan_settings.maybeSingle'] = [null];
    mocks.responses['memberships.then'] = [[]];
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      families: [],
      people: [],
      memberships: [],
      payments: [],
    });
  });

  it('uses an array family relation and reports a failed payment history query', async () => {
    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_family_members.select': [
        [{ id: 'owner-row', family_id: 'family-1', user_id: 'owner-1', status: 'confirmed' }],
        [{ id: 'owner-row', user_id: 'owner-1', status: 'confirmed', profiles: null }],
        [],
      ],
      'membership_families.select': [
        [
          {
            id: 'family-1',
            season_year: 2026,
            paid_at: null,
            paid_by: null,
            payment_id: null,
          },
        ],
      ],
      'profiles.select': [[]],
      'membership_plan_settings.maybeSingle': [settings],
      'memberships.select': [[{ id: 'membership-1' }]],
      'payments.select': [{ data: null, error: { message: 'payment history unavailable' } }],
    };

    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not load payment history: payment history unavailable',
    });
  });

  it('treats absent family and membership query data as empty results for an unprofiled account', async () => {
    mocks.responses['profiles.maybeSingle'] = [null];
    mocks.responses['membership_family_members.select'] = [null, null, null];
    mocks.responses['profiles.select'] = [null];
    mocks.responses['membership_plan_settings.maybeSingle'] = [null];
    mocks.responses['memberships.select'] = [null];

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      families: [],
      people: [],
      memberships: [],
      payments: [],
    });
  });

  it('skips orphaned family rows and normalizes a family profile with no joined record', async () => {
    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_family_members.select': [
        [
          {
            id: 'orphan-row',
            family_id: 'missing-family',
            user_id: 'owner-1',
            status: 'confirmed',
          },
        ],
        [],
      ],
      'membership_families.select': [null],
      'profiles.select': [null],
      'membership_plan_settings.maybeSingle': [null],
      'memberships.select': [null],
    };
    const orphaned = await GET();
    expect(orphaned.status).toBe(200);
    expect(await orphaned.json()).toMatchObject({ families: [], people: [], memberships: [] });

    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_family_members.select': [
        [
          {
            id: 'owner-row',
            family_id: 'family-1',
            user_id: 'owner-1',
            status: 'confirmed',
            created_at: '2026-01-01',
          },
        ],
        [{ id: 'owner-row', user_id: 'owner-1', status: 'confirmed', profiles: [] }],
        [],
      ],
      'membership_families.select': [
        [
          {
            id: 'family-1',
            season_year: 2026,
            paid_at: null,
            paid_by: null,
            payment_id: null,
          },
        ],
      ],
      'profiles.select': [[]],
      'membership_plan_settings.maybeSingle': [settings],
      'memberships.select': [[]],
      'payments.select': [[]],
    };
    const family = await GET();
    expect(family.status).toBe(200);
    expect(await family.json()).toMatchObject({
      families: [{ members: [{ profiles: null }] }],
    });
  });

  it('returns joined family details, availability, and payment records for an existing family', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_family_members.select'] = [
      [
        {
          id: 'owner-row',
          family_id: 'family-1',
          user_id: 'owner-1',
          invited_by: 'owner-1',
          status: 'confirmed',
          joined_at: '2026-01-01',
          created_at: '2026-01-01',
        },
      ],
      [
        {
          id: 'owner-row',
          user_id: 'owner-1',
          status: 'confirmed',
          invited_by: 'owner-1',
          profiles: [{ id: 'owner-1', full_name: 'Owner Member', email: 'owner@example.com' }],
        },
        {
          id: 'invite-row',
          user_id: 'invite-1',
          status: 'pending',
          invited_by: 'owner-1',
          profiles: { id: 'invite-1', full_name: 'Invite Member', email: 'invite@example.com' },
        },
      ],
      [
        { user_id: 'invite-1', status: 'pending' },
        { user_id: 'another-family-member', status: 'confirmed' },
      ],
    ];
    mocks.responses['membership_families.select'] = [
      [
        {
          id: 'family-1',
          season_year: 2026,
          paid_at: '2026-04-01',
          paid_by: 'owner-1',
          payment_id: 'payment-1',
        },
      ],
    ];
    mocks.responses['profiles.select'] = [
      [
        { id: 'available-1', full_name: 'Available Member' },
        { id: 'invite-1', full_name: 'Invite Member' },
      ],
    ];
    mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
    mocks.responses['memberships.select'] = [[{ id: 'membership-1', membership_type: 'single' }]];
    mocks.responses['payments.select'] = [
      [{ id: 'payment-1', membership_id: 'membership-1', status: 'paid' }],
    ];

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      families: [
        {
          membership: { id: 'owner-row', family_id: 'family-1' },
          family: { id: 'family-1', season_year: 2026, payment_id: 'payment-1' },
          members: [
            { profiles: { full_name: 'Owner Member' } },
            { profiles: { full_name: 'Invite Member' } },
          ],
        },
      ],
      people: [
        { id: 'available-1', available: true },
        { id: 'invite-1', available: false },
      ],
      memberships: [{ id: 'membership-1' }],
      payments: [{ id: 'payment-1', status: 'paid' }],
    });
  });

  it('reports server errors from approved people, plan settings, memberships, and family availability loads', async () => {
    const cases = [
      ['profiles', 'Could not load approved member list: profiles unavailable'],
      ['membership_plan_settings', 'Could not load membership prices: settings unavailable'],
      ['memberships', 'Could not load your membership: memberships unavailable'],
    ] as const;
    for (const [table, message] of cases) {
      mocks.responses = {
        'profiles.maybeSingle': [owner],
        [table === 'membership_plan_settings' ? `${table}.maybeSingle` : `${table}.select`]: [
          {
            data: table === 'membership_plan_settings' ? null : [],
            error: { message: message.split(': ').at(-1) },
          },
        ],
      };
      const response = await GET();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: message });
    }

    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_family_members.select': [
        [],
        { data: [], error: { message: 'availability unavailable' } },
      ],
    };
    const availability = await GET();
    expect(availability.status).toBe(500);
    expect(await availability.json()).toEqual({
      error: 'Could not load family availability: availability unavailable',
    });
  });

  it('reports a missing member profile and rejects self/unknown invites', async () => {
    mocks.responses['profiles.maybeSingle'] = [null];
    expect((await POST(request({ action: 'invite', userId: 'target-1' }))).status).toBe(409);

    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    expect((await POST(request({ action: 'invite', userId: 'owner-1' }))).status).toBe(400);

    mocks.responses['profiles.maybeSingle'] = [owner, { ...target, application_status: 'pending' }];
    expect((await POST(request({ action: 'invite', userId: 'target-1' }))).status).toBe(404);
  });

  it('blocks duplicate pending or already-family-member invitations', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner, target];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.select'] = [[{ status: 'pending' }]];
    const pendingResponse = await POST(request({ action: 'invite', userId: 'target-1' }));
    expect([pendingResponse.status, await pendingResponse.json()]).toEqual([
      409,
      { error: 'Resolve your pending family invitation first.' },
    ]);

    mocks.responses['profiles.maybeSingle'] = [owner, target];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.select'] = [
      [],
      [{ id: 'existing', status: 'confirmed' }],
    ];
    expect((await POST(request({ action: 'invite', userId: 'target-1' }))).status).toBe(409);
  });

  it('creates a family and records owner plus pending invite as separate membership rows', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner, target];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.select'] = [
      [],
      [],
      [{ user_id: 'owner-1', profiles: { date_of_birth: '1980-01-01' } }],
    ];
    mocks.responses['membership_families.single'] = [{ id: 'family-1' }];

    const response = await POST(request({ action: 'invite', userId: 'target-1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, familyCreated: true });
    expect(mocks.calls).toEqual([
      {
        table: 'membership_families',
        operation: 'insert',
        values: expect.objectContaining({ season_year: expect.any(Number) }),
      },
      {
        table: 'membership_family_members',
        operation: 'insert',
        values: expect.objectContaining({
          family_id: 'family-1',
          user_id: 'owner-1',
          status: 'confirmed',
        }),
      },
      {
        table: 'membership_family_members',
        operation: 'insert',
        values: {
          family_id: 'family-1',
          user_id: 'target-1',
          invited_by: 'owner-1',
          status: 'pending',
        },
      },
    ]);
  });

  it('invites a child into the current family without creating a duplicate family', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner, { ...target, date_of_birth: '2015-02-02' }];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.select'] = [
      [{ family_id: 'family-current', status: 'confirmed' }],
      [],
      [{ user_id: 'owner-1', profiles: { date_of_birth: '1980-01-01' } }],
    ];

    const response = await POST(request({ action: 'invite', userId: 'target-1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, familyCreated: false });
    expect(mocks.calls.some((call) => call.table === 'membership_families')).toBe(false);
    expect(mocks.calls).toContainEqual({
      table: 'membership_family_members',
      operation: 'insert',
      values: {
        family_id: 'family-current',
        user_id: 'target-1',
        invited_by: 'owner-1',
        status: 'pending',
      },
    });
  });

  it('uses the current calendar year when creating a family without plan settings', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner, target];
    mocks.responses['membership_plan_settings.single'] = [null];
    mocks.responses['membership_family_members.select'] = [
      [],
      [],
      [{ user_id: 'owner-1', profiles: { date_of_birth: null } }],
    ];
    mocks.responses['membership_families.single'] = [{ id: 'family-default-season' }];

    const response = await POST(request({ action: 'invite', userId: 'target-1' }));
    expect(response.status).toBe(200);
    expect(mocks.calls).toContainEqual({
      table: 'membership_families',
      operation: 'insert',
      values: { season_year: new Date().getFullYear() },
    });
  });

  it('emails an escaped family invitation after the pending membership row is saved', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.responses['profiles.maybeSingle'] = [owner, { ...target, full_name: '<Target>' }];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.select'] = [
      [],
      [],
      [{ user_id: 'owner-1', profiles: { date_of_birth: '1980-01-01' } }],
    ];
    mocks.responses['membership_families.single'] = [{ id: 'family-mail' }];

    const response = await POST(request({ action: 'invite', userId: 'target-1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, familyCreated: true });
    expect(mocks.calls.at(-1)).toMatchObject({
      table: 'membership_family_members',
      operation: 'insert',
      values: { family_id: 'family-mail', user_id: 'target-1', status: 'pending' },
    });
    const email = JSON.parse(mocks.fetch.mock.calls[0][1].body as string);
    expect(email.from).toBe('club@example.com');
    expect(email.to).toEqual(['target@example.com']);
    expect(email.html).toContain('&lt;Target&gt;');
  });

  it('keeps the invitation saved and returns a warning when invitation email delivery fails', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.fetch.mockResolvedValue(new Response('provider unavailable', { status: 503 }));
    mocks.responses['profiles.maybeSingle'] = [owner, target];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.select'] = [
      [],
      [],
      [{ user_id: 'owner-1', profiles: { date_of_birth: '1980-01-01' } }],
    ];
    mocks.responses['membership_families.single'] = [{ id: 'family-mail-failed' }];

    const response = await POST(request({ action: 'invite', userId: 'target-1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      warning: expect.stringContaining('email could not be sent'),
    });
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'membership_family_members',
        operation: 'insert',
        values: expect.objectContaining({ family_id: 'family-mail-failed', status: 'pending' }),
      }),
    );
  });

  it('rejects accepting an invitation when the member already belongs to a family', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 1 }];
    mocks.responses['membership_family_members.maybeSingle'] = [
      { id: 'invite-1', family_id: 'family-1', status: 'pending' },
    ];
    mocks.responses['membership_family_members.select'] = [
      [{ user_id: 'owner-2', profiles: { date_of_birth: '1985-01-01' } }],
      [{ id: 'existing-family' }],
    ];
    const response = await POST(
      request({
        action: 'confirm',
        invitationId: 'invite-1',
        waiverAccepted: true,
        waiverVersion: 1,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Leave your current family before accepting another invitation.',
    });
    expect(mocks.calls).toEqual([]);
  });

  it('enforces adult limits on acceptance and does not confirm an over-capacity invitation', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [{ ...settings, family_max_adults: 1 }];
    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 1 }];
    mocks.responses['membership_family_members.maybeSingle'] = [
      { id: 'invite-1', family_id: 'family-1', status: 'pending' },
    ];
    mocks.responses['membership_family_members.select'] = [
      [{ user_id: 'owner-2', profiles: { date_of_birth: '1985-01-01' } }],
      [],
    ];
    const response = await POST(
      request({
        action: 'confirm',
        invitationId: 'invite-1',
        waiverAccepted: true,
        waiverVersion: 1,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('at its limit') });
    expect(mocks.calls).toEqual([]);
  });

  it('confirms a valid invitation and records the acceptance timestamp', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 1 }];
    mocks.responses['membership_family_members.maybeSingle'] = [
      { id: 'invite-2', family_id: 'family-2', status: 'pending' },
    ];
    mocks.responses['membership_family_members.select'] = [
      [{ user_id: 'owner-2', status: 'confirmed', profiles: { date_of_birth: '1985-02-02' } }],
      [],
    ];

    const response = await POST(
      request({
        action: 'confirm',
        invitationId: 'invite-2',
        waiverAccepted: true,
        waiverVersion: 1,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.calls).toContainEqual({
      table: 'membership_family_members',
      operation: 'update',
      values: expect.objectContaining({ status: 'confirmed', joined_at: expect.any(String) }),
    });
  });

  it('uses the not-yet-reached birthday when checking family age limits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    mocks.responses['profiles.maybeSingle'] = [{ ...owner, date_of_birth: '1980-11-04' }];
    mocks.responses['membership_plan_settings.single'] = [{ ...settings, family_max_adults: 1 }];
    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 1 }];
    mocks.responses['membership_family_members.maybeSingle'] = [
      { id: 'invite-birthday', family_id: 'family-1', status: 'pending' },
    ];
    mocks.responses['membership_family_members.select'] = [
      [{ user_id: 'owner-2', status: 'confirmed', profiles: { date_of_birth: '1985-01-01' } }],
      [],
    ];

    try {
      const response = await POST(
        request({
          action: 'confirm',
          invitationId: 'invite-birthday',
          waiverAccepted: true,
          waiverVersion: 1,
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('at its limit'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns not-found for missing invitations/family membership and reports failed departure writes', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 1 }];
    mocks.responses['membership_family_members.maybeSingle'] = [null];
    const missingInvite = await POST(
      request({ action: 'confirm', invitationId: 'missing', waiverAccepted: true }),
    );
    expect(missingInvite.status).toBe(404);
    expect(await missingInvite.json()).toEqual({ error: 'Invitation not found.' });

    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.maybeSingle'] = [null];
    const notMember = await POST(request({ action: 'remove', familyId: 'family-1' }));
    expect(notMember.status).toBe(404);
    expect(await notMember.json()).toEqual({ error: 'You are not in a family.' });

    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.maybeSingle'] = [
      { id: 'member-row', family_id: 'family-1', membership_families: null },
    ];
    mocks.responses['membership_family_members.update'] = [
      { data: null, error: { message: 'write denied' } },
    ];
    const failed = await POST(request({ action: 'remove', familyId: 'family-1' }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Unexpected error.' });
  });

  it('deletes a newly created family when an invited child exceeds the configured limit', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner, { ...target, date_of_birth: '2015-02-02' }];
    mocks.responses['membership_plan_settings.single'] = [{ ...settings, family_max_children: 0 }];
    mocks.responses['membership_family_members.select'] = [[], [], []];
    mocks.responses['membership_families.single'] = [{ id: 'family-over-capacity' }];

    const response = await POST(request({ action: 'invite', userId: 'target-1' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Family limit exceeded'),
    });
    expect(mocks.calls).toContainEqual({
      table: 'membership_families',
      operation: 'delete',
    });
    expect(
      mocks.calls.some(
        (call) =>
          call.table === 'membership_family_members' &&
          call.operation === 'insert' &&
          (call.values as { status?: string })?.status === 'pending',
      ),
    ).toBe(false);
  });

  it('marks paid-family departures effective next season and unpaid departures declined', async () => {
    const year = new Date().getFullYear();
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['membership_family_members.maybeSingle'] = [
      {
        id: 'member-row',
        family_id: 'family-1',
        membership_families: { paid_at: '2026-01-01', season_year: year },
      },
    ];
    const paidResponse = await POST(request({ action: 'remove', familyId: 'family-1' }));
    expect(paidResponse.status).toBe(200);
    expect(await paidResponse.json()).toEqual({ success: true, effectiveNextSeason: true });
    expect(mocks.calls.at(-1)).toMatchObject({
      table: 'membership_family_members',
      operation: 'update',
      values: { status: 'removed_next_season' },
    });

    mocks.calls = [];
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_family_members.maybeSingle'] = [
      {
        id: 'member-row-2',
        family_id: 'family-2',
        membership_families: { paid_at: null, season_year: year },
      },
    ];
    const unpaidResponse = await POST(request({ action: 'remove', familyId: 'family-2' }));
    expect(unpaidResponse.status).toBe(200);
    expect(await unpaidResponse.json()).toEqual({ success: true, effectiveNextSeason: false });
    expect(mocks.calls.at(-1)).toMatchObject({ values: { status: 'declined' } });

    mocks.calls = [];
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_family_members.maybeSingle'] = [
      {
        id: 'member-row-3',
        family_id: 'family-3',
        membership_families: [{ paid_at: '2026-01-01', season_year: year - 1 }],
      },
    ];
    const priorSeason = await POST(request({ action: 'remove', familyId: 'family-3' }));
    expect(await priorSeason.json()).toEqual({ success: true, effectiveNextSeason: false });
    expect(mocks.calls.at(-1)).toMatchObject({ values: { status: 'declined' } });
  });

  it('rejects unknown actions and invalid invitations without mutating data', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    const response = await POST(request({ action: 'unknown' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown action.' });
    expect(mocks.calls).toEqual([]);
  });

  it('records an individual waiver before membership payment and validates family departure IDs', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 1 }];
    mocks.responses['memberships.maybeSingle'] = [null];
    const accepted = await POST(
      request({ action: 'accept_waiver', waiverAccepted: true, waiverVersion: 1 }),
    );
    expect(accepted.status).toBe(200);
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'memberships',
        operation: 'insert',
        values: expect.objectContaining({
          user_id: 'owner-1',
          status: 'pending',
          payment_status: 'unpaid',
          waiver_version: '1',
          waiver_accepted_at: expect.any(String),
        }),
      }),
    );

    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_plan_settings.single': [settings],
    };
    const missingFamilyId = await POST(request({ action: 'remove' }));
    expect(missingFamilyId.status).toBe(400);
    expect(await missingFamilyId.json()).toEqual({ error: 'Family ID is required.' });
  });

  it('enforces waiver eligibility and records family waiver acceptance', async () => {
    mocks.responses['profiles.maybeSingle'] = [{ ...owner, application_status: 'pending' }];
    mocks.responses['membership_plan_settings.single'] = [settings];
    const unapproved = await POST(request({ action: 'accept_waiver', waiverAccepted: true }));
    expect(unapproved.status).toBe(403);
    expect(await unapproved.json()).toEqual({ error: 'An approved member account is required.' });

    mocks.responses['profiles.maybeSingle'] = [{ ...owner, account_kind: 'event_guest' }];
    const guest = await POST(request({ action: 'accept_waiver', waiverAccepted: true }));
    expect(guest.status).toBe(403);

    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_plan_settings.single': [settings],
      'legal_document_versions.maybeSingle': [null],
    };
    const missingWaiver = await POST(request({ action: 'accept_waiver', waiverAccepted: true }));
    expect(missingWaiver.status).toBe(503);
    expect(await missingWaiver.json()).toEqual({
      error: 'The current membership waiver is unavailable.',
    });

    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_plan_settings.single': [settings],
      'legal_document_versions.maybeSingle': [{ version: 3 }],
      'membership_family_members.maybeSingle': [{ id: 'family-member-row' }],
    };
    const accepted = await POST(
      request({
        action: 'accept_waiver',
        waiverAccepted: true,
        waiverVersion: 3,
        familyId: 'family-1',
      }),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ success: true, acceptedAt: expect.any(String) });
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'membership_family_members',
        operation: 'update',
        values: expect.objectContaining({
          waiver_version: '3',
          waiver_accepted_at: expect.any(String),
        }),
      }),
    );

    mocks.calls = [];
    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_plan_settings.single': [settings],
      'legal_document_versions.maybeSingle': [{ version: 3 }],
      'membership_family_members.maybeSingle': [null],
    };
    const noFamily = await POST(
      request({
        action: 'accept_waiver',
        waiverAccepted: true,
        familyId: 'missing',
      }),
    );
    expect(noFamily.status).toBe(404);
    expect(await noFamily.json()).toEqual({ error: 'No family membership was found.' });
  });

  it('uses configured season dates when accepting an individual waiver and reports insert errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_plan_settings.single': [settings],
      'legal_document_versions.maybeSingle': [{ version: 4 }],
      'memberships.maybeSingle': [null],
      'memberships.insert': [{ data: null, error: { message: 'insert denied' } }],
    };
    try {
      const failed = await POST(request({ action: 'accept_waiver', waiverAccepted: true }));
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: 'Unexpected error.' });
      expect(mocks.calls).toContainEqual(
        expect.objectContaining({
          table: 'memberships',
          operation: 'insert',
          values: expect.objectContaining({ starts_on: '2026-04-01', ends_on: '2026-09-30' }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires the current waiver version and updates an existing season membership', async () => {
    mocks.responses['profiles.maybeSingle'] = [owner];
    mocks.responses['membership_plan_settings.single'] = [settings];
    const unchecked = await POST(request({ action: 'accept_waiver', waiverAccepted: false }));
    expect(unchecked.status).toBe(400);
    expect(await unchecked.json()).toEqual({
      error: 'Confirm that you accept the current membership waiver.',
    });

    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 2 }];
    const changed = await POST(
      request({ action: 'accept_waiver', waiverAccepted: true, waiverVersion: 1 }),
    );
    expect(changed.status).toBe(409);

    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_plan_settings.single': [settings],
      'legal_document_versions.maybeSingle': [{ version: 2 }],
      'memberships.maybeSingle': [{ id: 'membership-current' }],
    };
    const accepted = await POST(
      request({ action: 'accept_waiver', waiverAccepted: true, waiverVersion: 2 }),
    );
    expect(accepted.status).toBe(200);
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'memberships',
        operation: 'update',
        values: expect.objectContaining({
          waiver_version: '2',
          waiver_accepted_at: expect.any(String),
        }),
      }),
    );
  });

  it('reports membership payment history query failures', async () => {
    mocks.responses = {
      'profiles.maybeSingle': [owner],
      'membership_family_members.select': [[], [], []],
      'profiles.select': [[]],
      'membership_plan_settings.maybeSingle': [settings],
      'memberships.select': [[{ id: 'membership-1', user_id: 'owner-1' }]],
      'payments.select': [{ data: null, error: { message: 'payments unavailable' } }],
    };
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not load payment history: payments unavailable',
    });
  });
});
