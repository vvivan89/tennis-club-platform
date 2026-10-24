import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const consolidated = readFileSync('supabase/consolidated_migrations.sql', 'utf8');
const start = consolidated.indexOf('-- BEGIN MIGRATION: 0035_chat_mentions_notifications.sql');
const end = consolidated.indexOf('-- BEGIN MIGRATION:', start + 1);
const migration = consolidated.slice(start, end < 0 ? undefined : end);

describe('chat mention and notification migration', () => {
  it('adds a constrained member notification preference and mention recipients', () => {
    expect(migration).toContain('chat_notification_preference');
    expect(migration).toContain("'all', 'mentions', 'none'");
    expect(migration).toContain('mentions uuid[]');
  });

  it('keeps chat out of audit logging', () => {
    expect(migration).not.toMatch(/record_business_audit_event|audit_log/i);
  });
});
