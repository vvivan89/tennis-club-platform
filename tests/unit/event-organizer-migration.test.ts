import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migration_archive/0033_event_organizers_and_member_contacts.sql'),
  'utf8',
);
const eventPage = readFileSync(join(process.cwd(), 'app/events/[slug]/page.tsx'), 'utf8');

describe('event organizer access migration', () => {
  it('stores an organizer separately and backfills existing event creators', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS organizer_id uuid');
    expect(migration).toContain('SET organizer_id = e.created_by');
    expect(migration).toContain("p.role IN ('admin', 'organizer')");
    expect(migration).toContain('"position" text');
  });

  it('gates private organizer contacts on the existing ever-paid membership rule', () => {
    expect(migration).toContain('public.has_ever_paid_membership(auth.uid())');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.event_organizer_contacts(uuid) FROM PUBLIC, anon',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.event_organizer_contacts(uuid) TO authenticated',
    );
    expect(migration).toContain("e.status IN ('published', 'cancelled')");
    expect(eventPage).toContain("db.rpc('event_organizer_contacts', { p_event_id: event.id })");
  });

  it('prevents organizer accounts from assigning another organizer', () => {
    expect(migration).toContain('Only administrators can assign another event organizer');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF organizer_id ON public.events');
  });
});
