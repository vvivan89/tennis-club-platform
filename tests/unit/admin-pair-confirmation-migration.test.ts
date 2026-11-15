import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261117130000_auto_confirm_admin_created_pairs.sql'),
  'utf8',
);
const replacementMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261117140000_auto_confirm_admin_pair_replacements.sql',
  ),
  'utf8',
);

describe('Admin-created pair confirmation migration', () => {
  it('confirms both participants in the manager pair-creation RPC', () => {
    expect(migration).toContain("SET confirmation_status = 'confirmed'");
    expect(migration).toContain('WHERE id IN (p_one, p_two) AND event_id = p_event_id');
  });

  it('backfills pending pairs only when their audit record identifies a manager as creator', () => {
    expect(migration).toContain("audit.entity_type = 'tournament_pairs'");
    expect(migration).toContain("actor.role IN ('admin', 'organizer')");
    expect(migration).toContain("participant.confirmation_status = 'pending'");
  });

  it('confirms manager replacements while keeping player-created invitations separate', () => {
    expect(replacementMigration).toContain("SET confirmation_status = 'confirmed'");
    expect(replacementMigration).toContain("audit.action = 'update'");
    expect(replacementMigration).toContain('audit.before_data');
  });
});
