import { describe, expect, it } from 'vitest';
import { mapInChunks } from '@/lib/async';
import { fetchAllRows } from '@/lib/fetch-all-rows';

describe('mapInChunks', () => {
  it('keeps input order and never runs more than the chunk size at once', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapInChunks([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5 * (6 - n)));
      active--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });

  it('handles an empty list', async () => {
    expect(await mapInChunks([], 3, async (n: number) => n)).toEqual([]);
  });
});

describe('fetchAllRows', () => {
  it('reads pages until a short page and reports an error with the rows so far', async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => i), [1000, 1001]];
    const ranges: Array<[number, number]> = [];
    const ok = await fetchAllRows<number>(async (from, to) => {
      ranges.push([from, to]);
      return { data: pages[ranges.length - 1], error: null };
    });
    expect(ok.rows).toHaveLength(1002);
    expect(ok.error).toBeNull();
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);

    const failed = await fetchAllRows<number>(async () => ({
      data: null,
      error: { message: 'x' },
    }));
    expect(failed).toEqual({ rows: [], error: { message: 'x' } });
  });
});
