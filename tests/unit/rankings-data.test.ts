import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRankingsData } from '@/lib/rankings-data';

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

function queryFor(table: string) {
  const result = { data: mocks.tables[table] ?? [], error: null };
  const query = {
    select: () => query,
    eq: () => query,
    neq: () => query,
    in: () => query,
    order: () => query,
    maybeSingle: async () => ({ data: mocks.tables[table] ?? null, error: null }),
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

const baseTables = {
  profiles: [
    {
      id: 'p1',
      full_name: ' Alex One ',
      email: 'alex@example.com',
      tennis_skill_level: '3.5',
      gender: 'male',
      application_status: 'approved',
      role: 'member',
    },
    {
      id: 'p2',
      full_name: null,
      email: 'bee@example.com',
      tennis_skill_level: null,
      gender: null,
      application_status: 'approved',
      role: 'member',
    },
    {
      id: 'p3',
      full_name: 'Casey Three',
      email: 'casey@example.com',
      tennis_skill_level: '4.0',
      gender: 'female',
      application_status: 'approved',
      role: 'member',
    },
    {
      id: 'p4',
      full_name: 'Drew Four',
      email: 'drew@example.com',
      tennis_skill_level: '4.5',
      gender: 'male',
      application_status: 'approved',
      role: 'member',
    },
    {
      id: 'p5',
      full_name: '',
      email: null,
      tennis_skill_level: null,
      gender: null,
      application_status: 'approved',
      role: 'member',
    },
  ],
  memberships: [
    { id: 'm1', user_id: 'p1', status: 'active', payment_status: 'unpaid' },
    { id: 'm2', user_id: 'p2', status: 'expired', payment_status: 'paid' },
    { id: 'm3', user_id: 'p3', status: 'pending', payment_status: 'paid' },
  ],
  payments: [{ business_record_id: 'm1', user_id: 'p1', status: 'paid' }],
  membership_families: [
    { id: 'f1', paid_at: '2025-04-01T00:00:00Z' },
    { id: 'f2', paid_at: null },
  ],
  membership_family_members: [
    { user_id: 'p4', family_id: 'f1', status: 'confirmed' },
    { user_id: 'p5', family_id: 'f2', status: 'confirmed' },
  ],
  membership_plan_settings: {
    season_start_month: 5,
    season_start_day: 1,
    season_end_month: 10,
    season_end_day: 31,
  },
  event_scores: [
    {
      id: 'single',
      event_id: 'e1',
      played_at: '2025-06-01T12:00:00Z',
      player_one_registration_id: 'r1',
      player_two_registration_id: 'r2',
      player_three_registration_id: null,
      player_four_registration_id: null,
      player_one_score: 6,
      player_two_score: 3,
    },
    {
      id: 'doubles',
      event_id: 'e1',
      played_at: '2025-06-02T12:00:00Z',
      player_one_registration_id: 'r1',
      player_two_registration_id: 'r2',
      player_three_registration_id: 'r3',
      player_four_registration_id: 'r4',
      player_one_score: 2,
      player_two_score: 6,
    },
    {
      id: 'future',
      event_id: 'e1',
      played_at: '2999-01-01T00:00:00Z',
      player_one_registration_id: 'r1',
      player_two_registration_id: 'r2',
      player_three_registration_id: null,
      player_four_registration_id: null,
      player_one_score: 6,
      player_two_score: 0,
    },
    {
      id: 'missing-player',
      event_id: 'e1',
      played_at: '2025-06-03T12:00:00Z',
      player_one_registration_id: 'missing',
      player_two_registration_id: 'r2',
      player_three_registration_id: null,
      player_four_registration_id: null,
      player_one_score: 6,
      player_two_score: 0,
    },
  ],
  events: [{ id: 'e1', title: 'Summer Ladder', starts_at: '2025-06-01T12:00:00Z', ends_at: null }],
  registrations: [
    { id: 'r1', user_id: 'p1', event_id: 'e1' },
    { id: 'r2', user_id: 'p2', event_id: 'e1' },
    { id: 'r3', user_id: 'p3', event_id: 'e1' },
    { id: 'r4', user_id: 'p4', event_id: 'e1' },
  ],
};

beforeEach(() => {
  mocks.tables = structuredClone(baseTables);
  mocks.createClient.mockImplementation(() => ({ from: (table: string) => queryFor(table) }));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('getRankingsData', () => {
  it('requires server-side Supabase configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(getRankingsData()).rejects.toThrow(
      'Server-side Supabase configuration is missing.',
    );
  });

  it('includes active or expired paid members and members of a previously paid family', async () => {
    const result = await getRankingsData();
    expect([...result.eligibleUserIds].sort()).toEqual(['p1', 'p2', 'p4']);
    expect(result.profileById.get('p1')).toBe('Alex One');
    expect(result.profileById.get('p2')).toBe('bee@example.com');
    expect(result.profileById.get('p5')).toBe('Player');
  });

  it('builds singles and doubles games, skips future/incomplete scores, and computes player totals', async () => {
    const result = await getRankingsData();
    expect(result.games).toHaveLength(2);
    expect(result.games[0]).toMatchObject({
      id: 'single',
      eventTitle: 'Summer Ladder',
      sideOneIds: ['p1'],
      sideTwoIds: ['p2'],
    });
    expect(result.games[1]).toMatchObject({
      id: 'doubles',
      playerIds: ['p1', 'p2', 'p3', 'p4'],
      sideOneIds: ['p1', 'p2'],
      sideTwoIds: ['p3', 'p4'],
    });
    expect(result.players.find((player) => player.id === 'p1')).toMatchObject({
      name: 'Alex One',
      gamesWon: 8,
      gamesLost: 9,
      setsWon: 1,
      setsLost: 1,
      gamesPlayed: 2,
    });
    expect(result.players.find((player) => player.id === 'p3')?.setsWon).toBe(1);
  });

  it('uses default season settings and skips games with unresolved opponents or missing dates', async () => {
    delete mocks.tables.membership_plan_settings;
    mocks.tables.event_scores = [
      {
        id: 'no-date',
        event_id: 'unknown',
        played_at: null,
        player_one_registration_id: 'r1',
        player_two_registration_id: 'r2',
        player_three_registration_id: null,
        player_four_registration_id: null,
        player_one_score: 1,
        player_two_score: 0,
      },
    ];
    const result = await getRankingsData();
    expect(result.settings).toEqual({
      season_start_month: 4,
      season_start_day: 1,
      season_end_month: 9,
      season_end_day: 30,
    });
    expect(result.games).toEqual([]);
  });

  it('uses event timestamps for completed tournament sets and handles entirely empty score data', async () => {
    mocks.tables.events = [
      { id: 'tournament-event', title: '', starts_at: '2025-06-01T12:00:00Z', ends_at: null },
      { id: 'unknown-date', title: 'No date', starts_at: '', ends_at: null },
    ];
    mocks.tables.event_scores = [];
    mocks.tables.tournament_ranked_sets = [
      {
        id: 'tournament-set',
        event_id: 'tournament-event',
        played_at: null,
        player_one_user_id: 'p1',
        player_two_user_id: null,
        player_three_user_id: 'p2',
        player_four_user_id: null,
        player_one_score: 0,
        player_two_score: 6,
      },
      {
        id: 'incomplete-set',
        event_id: 'tournament-event',
        played_at: '2025-06-02T12:00:00Z',
        player_one_user_id: 'p1',
        player_two_user_id: null,
        player_three_user_id: null,
        player_four_user_id: null,
        player_one_score: 6,
        player_two_score: 0,
      },
      {
        id: 'missing-date',
        event_id: 'unknown-date',
        played_at: null,
        player_one_user_id: 'p1',
        player_two_user_id: null,
        player_three_user_id: 'p2',
        player_four_user_id: null,
        player_one_score: 6,
        player_two_score: 2,
      },
    ];
    const result = await getRankingsData();
    expect(result.games).toEqual([
      expect.objectContaining({
        id: 'tournament-set',
        eventTitle: 'Tournament',
        playedAt: '2025-06-01T12:00:00Z',
        playerIds: ['p1', 'p2'],
        scoreOne: 0,
        scoreTwo: 6,
      }),
    ]);

    mocks.tables.event_scores = [];
    mocks.tables.tournament_ranked_sets = [];
    const empty = await getRankingsData();
    expect(empty.games).toEqual([]);
    expect(empty.players).toHaveLength(5);
  });
});
