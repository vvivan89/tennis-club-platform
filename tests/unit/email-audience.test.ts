import { describe, expect, it, vi } from 'vitest';
import { isEmailGroup, loadEmailRecipients, type EmailGroup } from '@/lib/email-audience';

type QueryResult = { data: unknown; error: { message: string } | null };

function mockDb(responses: Record<string, QueryResult[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    let method = 'select';
    const query: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ['select', 'eq', 'or', 'in', 'order', 'range']) {
      query[name] = (...args) => {
        calls.push({ table, method: name, args });
        if (name !== 'select' && name !== 'order' && name !== 'range') method = name;
        if (name === 'range') {
          const queue = responses[`${table}.range`] ?? responses[table] ?? [];
          return Promise.resolve(queue.shift() ?? { data: [], error: null });
        }
        return query;
      };
    }
    query.then = ((
      resolve: (result: QueryResult) => unknown,
      reject: (error: unknown) => unknown,
    ) => {
      const queue = responses[table] ?? [];
      return Promise.resolve(queue.shift() ?? { data: [], error: null }).then(resolve, reject);
    }) as (...args: unknown[]) => unknown;
    return query;
  });
  return { db: { from } as never, calls, from };
}

describe('email audience selection', () => {
  it('validates audience names and applies approved-member filters for standard groups', async () => {
    expect(isEmailGroup('all')).toBe(true);
    expect(isEmailGroup('newsletter')).toBe(true);
    expect(isEmailGroup('unexpected')).toBe(false);
    const groupCases: Array<{ group: EmailGroup; filter?: string }> = [
      { group: 'all' },
      { group: 'newsletter', filter: 'email_newsletter' },
      { group: 'admins', filter: 'role' },
      { group: 'organizers', filter: 'role' },
    ];
    for (const { group, filter } of groupCases) {
      const { db, calls } = mockDb({ profiles: [{ data: [], error: null }] });
      expect(await loadEmailRecipients(db, group)).toEqual([]);
      expect(calls).toContainEqual({
        table: 'profiles',
        method: 'eq',
        args: ['application_status', 'approved'],
      });
      if (filter) {
        expect(calls.some((call) => call.method === 'eq' && call.args[0] === filter)).toBe(true);
      }
      expect(calls.some((call) => call.method === 'range' && call.args[0] === 0)).toBe(true);
    }
  });

  it('deduplicates active membership users and batches their approved profile lookups', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `member-${index}`);
    const { db, calls } = mockDb({
      memberships: [{ data: [...ids, ids[0]].map((user_id) => ({ user_id })), error: null }],
      profiles: [
        {
          data: ids.slice(0, 50).map((id) => ({ id, email: `${id}@example.test`, full_name: id })),
          error: null,
        },
        { data: [{ id: ids[50], email: null, full_name: null }], error: null },
      ],
    });
    const recipients = await loadEmailRecipients(db, 'active_members');
    expect(recipients).toHaveLength(51);
    expect(calls.filter((call) => call.table === 'profiles' && call.method === 'in')).toHaveLength(
      2,
    );
    expect(calls).toContainEqual({
      table: 'memberships',
      method: 'eq',
      args: ['status', 'active'],
    });
    expect(
      calls.some(
        (call) => call.method === 'or' && String(call.args[0]).startsWith('ends_on.is.null'),
      ),
    ).toBe(true);
  });

  it('pages large audiences and throws consistently when membership or profile queries fail', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ id: `member-${index}` }));
    const { db, calls } = mockDb({
      profiles: [
        { data: firstPage, error: null },
        { data: [], error: null },
      ],
    });
    expect(await loadEmailRecipients(db, 'all')).toHaveLength(1000);
    expect(calls.filter((call) => call.method === 'range')).toEqual([
      { table: 'profiles', method: 'range', args: [0, 999] },
      { table: 'profiles', method: 'range', args: [1000, 1999] },
    ]);

    const membershipFailure = mockDb({ memberships: [{ data: null, error: { message: 'down' } }] });
    await expect(loadEmailRecipients(membershipFailure.db, 'active_members')).rejects.toThrow(
      'Could not load recipients.',
    );
    const profileFailure = mockDb({
      memberships: [{ data: [{ user_id: 'member-1' }], error: null }],
      profiles: [{ data: null, error: { message: 'down' } }],
    });
    await expect(loadEmailRecipients(profileFailure.db, 'active_members')).rejects.toThrow(
      'Could not load recipients.',
    );
    const standardFailure = mockDb({ profiles: [{ data: null, error: { message: 'down' } }] });
    await expect(loadEmailRecipients(standardFailure.db, 'newsletter')).rejects.toThrow(
      'Could not load recipients.',
    );
  });
});
