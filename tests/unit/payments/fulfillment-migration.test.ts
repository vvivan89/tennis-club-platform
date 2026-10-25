import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/0041_payment_fulfillment.sql');
const consolidatedPath = resolve(process.cwd(), 'supabase/consolidated_migrations.sql');

describe('payment fulfillment migration', () => {
  it('matches the consolidated migration and contains the current-schema fulfillment paths', async () => {
    const [migration, consolidated] = await Promise.all([
      readFile(migrationPath, 'utf8'),
      readFile(consolidatedPath, 'utf8'),
    ]);
    const marker = '-- BEGIN MIGRATION: 0041_payment_fulfillment.sql';
    const start = consolidated.lastIndexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(consolidated.slice(start)).toContain(migration.trim());
    expect(migration).toContain('public.fulfill_successful_payment');
    expect(migration).toContain("payment_status = 'paid'");
    expect(migration).toContain("r.payment_status IN ('pending', 'failed', 'paid')");
    expect(migration).toContain('public.has_active_paid_membership');
    expect(migration).toContain('payments_one_active_business_payment_uidx');
    expect(migration).toContain('waiver_accepted_at');
    expect(migration).not.toMatch(/payments\.(membership_id|notes)/i);
  });
});
