import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const consolidated = readFileSync('supabase/consolidated_migrations.sql', 'utf8');
const start = consolidated.indexOf('-- BEGIN MIGRATION: 0036_chat_member_display_names.sql');
const end = consolidated.indexOf('-- BEGIN MIGRATION:', start + 1);
const migration = consolidated.slice(start, end < 0 ? undefined : end);

describe('chat member display-name migration', () => {
  it('exposes only member IDs and names through an approved-member-only function', () => {
    expect(migration).toContain('FUNCTION public.get_member_chat_member_names()');
    expect(migration).toContain('RETURNS TABLE (id uuid, full_name text)');
    expect(migration).toContain("caller.application_status = 'approved'");
    expect(migration).toContain("p.application_status = 'approved'");
    expect(migration).toContain('SECURITY DEFINER');
  });

  it('does not grant anonymous execution or broaden direct profile access', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
    expect(migration).not.toMatch(/CREATE\s+POLICY.*profiles/i);
  });
});
