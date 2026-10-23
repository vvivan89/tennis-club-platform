/** Build the canonical public event path. Slugs are generated and collision-checked in Postgres. */
export function eventPath(event: { id: string; slug?: string | null }): string {
  return `/events/${event.slug || event.id}`;
}

/** Build the canonical event-management URL, matching the public event slug. */
export function eventEditPath(event: { id: string; slug?: string | null }): string {
  return `/admin/events/${event.slug || event.id}/edit`;
}
