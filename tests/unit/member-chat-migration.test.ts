import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const consolidated = readFileSync('supabase/consolidated_migrations.sql', 'utf8');
const migrationStart = consolidated.indexOf('-- BEGIN MIGRATION: 0034_member_group_chat.sql');
const migrationEnd = consolidated.indexOf('-- BEGIN MIGRATION:', migrationStart + 1);
const migration = consolidated.slice(migrationStart, migrationEnd < 0 ? undefined : migrationEnd);

describe('member chat database security and persistence contract', () => {
  it('persists messages and enables row-level security on messages and read markers', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.member_chat_messages/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.member_chat_reads/i);
    expect(migration).toMatch(
      /ALTER TABLE public\.member_chat_messages ENABLE ROW LEVEL SECURITY/i,
    );
    expect(migration).toMatch(/ALTER TABLE public\.member_chat_reads ENABLE ROW LEVEL SECURITY/i);
  });

  it('restricts reading and sending messages to authenticated approved members', () => {
    expect(migration).toMatch(
      /Approved members can read chat messages[\s\S]*?FOR SELECT TO authenticated[\s\S]*?application_status = 'approved'/i,
    );
    expect(migration).toMatch(
      /Approved members can send chat messages[\s\S]*?FOR INSERT TO authenticated[\s\S]*?user_id = \(SELECT auth\.uid\(\)\)[\s\S]*?application_status = 'approved'/i,
    );
    expect(migration).toMatch(
      /Authors can update own recent chat messages[\s\S]*?created_at >= now\(\) - interval '5 minutes'/i,
    );
    expect(migration).toMatch(
      /Authors can delete own recent chat messages[\s\S]*?created_at >= now\(\) - interval '5 minutes'/i,
    );
  });

  it('enforces the five-minute edit window and trims history to 2,000 messages', () => {
    expect(migration).toMatch(/OLD\.created_at < now\(\) - interval '5 minutes'/i);
    expect(migration).toMatch(/OFFSET 2000/i);
    expect(migration).toMatch(/AFTER INSERT ON public\.member_chat_messages/i);
  });

  it('limits private chat images to 1 MB and allows only supported image MIME types', () => {
    expect(migration).toMatch(
      /'member-chat-images',[\s\S]*?false, 1048576,[\s\S]*?image\/jpeg[\s\S]*?image\/png[\s\S]*?image\/gif[\s\S]*?image\/webp/i,
    );
    expect(migration).toMatch(/Approved members can upload own chat images/i);
  });

  it('publishes messages for realtime delivery without adding audit-log calls', () => {
    expect(migration).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.member_chat_messages/i,
    );
    expect(migration).not.toMatch(/record_business_audit_event|audit_log/i);
  });
});
