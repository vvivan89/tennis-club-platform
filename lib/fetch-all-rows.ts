const PAGE_SIZE = 1000;

/** Reads every page of a query so results are never silently cut at the API row limit. */
export async function fetchAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE_SIZE) return { rows, error: null };
  }
}
