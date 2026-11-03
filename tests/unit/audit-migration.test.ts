import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function migrationSection(name: string) {
  return readFileSync(join(process.cwd(), 'supabase/migration_archive', name), 'utf8');
}

const migration = migrationSection('0030_audit_statement_level.sql');

describe('audit logging migration', () => {
  it('uses statement-level rather than row-level audit triggers', () => {
    expect(migration).toContain(
      'FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()',
    );
    expect(migration).not.toMatch(/CREATE TRIGGER audit_row_change[\s\S]*?FOR EACH ROW/);
  });

  it('does not audit notification queue or email delivery records', () => {
    expect(migration).toContain("ARRAY['event_notification_queue','event_email_log']");
    expect(migration).toContain('DROP TRIGGER IF EXISTS audit_row_change ON public.%I');
  });

  it('saves a full court-assignment replacement as one audited business action', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.save_event_court_assignments');
    expect(migration).toContain("set_config('app.audit_suppressed', 'true', true)");
    expect(migration).toContain("'event_court_assignments.save'");
    expect(migration).toContain("'Court assignments saved (' || v_count");
  });
});

const readableMigration = migrationSection('0031_human_readable_audit_details.sql');
const logicalActionMigration = migrationSection('0032_log_logical_business_actions.sql');

describe('human-readable audit details migration', () => {
  it('records registration changes with player names and IDs instead of a full sample record', () => {
    expect(readableMigration).toContain("'affected_players'");
    expect(readableMigration).toContain("'player_name'");
    expect(readableMigration).toContain("'previous_player_name'");
    expect(readableMigration).toContain("'Registration added: '");
    expect(readableMigration).not.toContain("'sample_record',v_row");
  });

  it('records court movement by player, session, old court, and new court', () => {
    expect(readableMigration).toContain("'player_changes',v_changes");
    expect(readableMigration).toContain("'previous_court', o.court_number");
    expect(readableMigration).toContain("'new_court', n.court_number");
    expect(readableMigration).toContain("'session', coalesce(n.segment_order,o.segment_order)");
  });

  it('logs one court assignment save and avoids record-count wording in its summary', () => {
    expect(readableMigration).toContain("'event_court_assignments.save'");
    expect(readableMigration).toContain("'Court assignments updated: '");
    expect(readableMigration).not.toContain("'Court assignments updated ('");
  });
});

describe('logical business-action audit migration', () => {
  it('versions new records and deduplicates retries with scoped idempotency keys', () => {
    expect(logicalActionMigration).toContain('event_schema_version');
    expect(logicalActionMigration).toContain('idempotency_key');
    expect(logicalActionMigration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_idempotency_key_idx',
    );
    expect(logicalActionMigration).toContain('concat_ws(');
  });

  it('captures field diffs for generic writes and groups affected rows under entities', () => {
    expect(logicalActionMigration).toContain("'field_changes'");
    expect(logicalActionMigration).toContain("'old_value', to_jsonb(o)->fields.key");
    expect(logicalActionMigration).toContain("jsonb_build_object('entities', v_entities");
  });

  it('logs court, registration, withdrawal, and replacement at RPC boundaries', () => {
    for (const action of [
      "'event_court_assignments.save'",
      "'event.registration.created'",
      "'event.registration.withdrawn'",
      "'event.registration.replaced'",
    ])
      expect(logicalActionMigration).toContain(action);
    expect(logicalActionMigration).toContain("set_config('app.audit_suppressed', 'true', true)");
    expect(logicalActionMigration).toContain(
      "IF TG_TABLE_NAME IN ('event_notification_queue', 'event_email_log')",
    );
  });
});
