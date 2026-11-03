import { describe, expect, it, vi } from 'vitest';
import { findEventBySlugAlias } from '@/lib/event-alias';

function createDb(results: Array<{ data: unknown; error?: unknown }>) {
  const calls: Array<{ table: string; column: string; value: string }> = [];
  const db = {
    from(table: string) {
      let value = '';
      const query = {
        select: () => query,
        eq(column: string, nextValue: string) {
          value = nextValue;
          calls.push({ table, column, value });
          return query;
        },
        maybeSingle: vi.fn(async () => results.shift() ?? { data: null, error: null }),
      };
      return query;
    },
  };
  return { db, calls };
}

describe('findEventBySlugAlias', () => {
  it('returns null when no alias matches the retired slug', async () => {
    const { db, calls } = createDb([{ data: null }]);

    await expect(findEventBySlugAlias(db as never, 'old-event')).resolves.toBeNull();
    expect(calls).toEqual([{ table: 'event_slug_aliases', column: 'slug', value: 'old-event' }]);
  });

  it('loads the event for an alias and returns null if that event was removed', async () => {
    const { db, calls } = createDb([{ data: { event_id: 'event-1' } }, { data: null }]);

    await expect(findEventBySlugAlias(db as never, 'old-event')).resolves.toBeNull();
    expect(calls).toEqual([
      { table: 'event_slug_aliases', column: 'slug', value: 'old-event' },
      { table: 'events', column: 'id', value: 'event-1' },
    ]);
  });

  it('returns the event associated with a retired slug', async () => {
    const event = { id: 'event-1', slug: 'new-event' };
    const { db } = createDb([{ data: { event_id: event.id } }, { data: event }]);

    await expect(findEventBySlugAlias(db as never, 'old-event')).resolves.toEqual(event);
  });
});
