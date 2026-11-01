import type { createSupabaseServerClient } from '@/lib/supabase-server';

/** Looks up an event through a retired slug (event_slug_aliases). */
export async function findEventBySlugAlias(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  slug: string,
) {
  const { data: alias } = await db
    .from('event_slug_aliases')
    .select('event_id')
    .eq('slug', slug)
    .maybeSingle();
  if (!alias?.event_id) return null;
  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('id', alias.event_id)
    .maybeSingle();
  return event ?? null;
}
