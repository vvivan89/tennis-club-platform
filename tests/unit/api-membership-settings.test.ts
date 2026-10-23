import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  role: 'admin',
  writeError: null as null | { message: string },
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { role: mocks.role }, error: null }),
        upsert: async (values: Record<string, unknown>) => {
          mocks.writes.push(values);
          return { data: null, error: mocks.writeError };
        },
      };
      return query;
    },
  }),
}));

import { POST } from '@/app/api/admin/membership-settings/route';

const validSettings = {
  single_price_cad: 120.25,
  family_price_cad: 200,
  family_max_adults: 2,
  family_max_children: 4,
  season_start_date: '2026-04-01',
  season_end_date: '2026-09-30',
};

function request(body: unknown) {
  return new Request('https://club.example/api/admin/membership-settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.role = 'admin';
  mocks.writeError = null;
  mocks.writes = [];
});

describe('POST /api/admin/membership-settings', () => {
  it('rejects anonymous and non-admin callers before writing', async () => {
    mocks.user = null;
    expect((await POST(request(validSettings))).status).toBe(401);

    mocks.user = { id: 'organizer-1' };
    mocks.role = 'organizer';
    expect((await POST(request(validSettings))).status).toBe(403);
    expect(mocks.writes).toEqual([]);
  });

  it.each([
    { ...validSettings, single_price_cad: -1 },
    { ...validSettings, family_max_adults: 0 },
    { ...validSettings, family_max_children: 21 },
    { ...validSettings, season_start_date: '2026-02-30' },
    { ...validSettings, season_end_date: '2026-03-01' },
    { ...validSettings, family_price_cad: Number.NaN },
  ])('rejects invalid values without persisting settings', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mocks.writes).toEqual([]);
  });

  it('stores cents, season boundaries, limits, and authenticated actor', async () => {
    const response = await POST(request(validSettings));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0]).toMatchObject({
      id: 1,
      single_price_cents: 12025,
      family_price_cents: 20000,
      family_max_adults: 2,
      family_max_children: 4,
      season_start_month: 4,
      season_start_day: 1,
      season_end_month: 9,
      season_end_day: 30,
      updated_by: 'admin-1',
    });
  });

  it('returns persistence errors and malformed JSON as server errors', async () => {
    mocks.writeError = { message: 'database unavailable' };
    const writeResponse = await POST(request(validSettings));
    expect(writeResponse.status).toBe(500);
    expect(await writeResponse.json()).toMatchObject({
      error: expect.stringContaining('database unavailable'),
    });

    const malformed = new Request('https://club.example/api/admin/membership-settings', {
      method: 'POST',
      body: '{',
    });
    expect((await POST(malformed)).status).toBe(500);
  });
});
