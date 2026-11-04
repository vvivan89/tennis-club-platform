import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migration_archive/0041_payment_fulfillment.sql',
);
const partyMigrationPath = resolve(
  process.cwd(),
  'supabase/migration_archive/20261104100000_add_party_events.sql',
);
describe('payment fulfillment migration', () => {
  it('contains the current-schema fulfillment paths in the historical migration', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('public.fulfill_successful_payment');
    expect(migration).toContain("payment_status = 'paid'");
    expect(migration).toContain("r.payment_status IN ('pending', 'failed', 'paid')");
    expect(migration).toContain('public.has_active_paid_membership');
    expect(migration).toContain('payments_one_active_business_payment_uidx');
    expect(migration).toContain('waiver_accepted_at');
    expect(migration).not.toMatch(/payments\.(membership_id|notes)/i);
  });

  it('adds Party-only registration, eligibility, capacity, and payment fulfillment rules', async () => {
    const migration = await readFile(partyMigrationPath, 'utf8');
    expect(migration).toContain("event_type = 'party'");
    expect(migration).toContain('public.is_approved_club_member()');
    expect(migration).toContain('public.register_for_party_event');
    expect(migration).toContain('guest_count');
    expect(migration).toContain(
      "e.event_type = ''party'' OR e.price_cents = v_payment.amount_minor",
    );
  });
});
