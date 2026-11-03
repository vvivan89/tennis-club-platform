import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migration_archive/0038_chat_member_avatars.sql', 'utf8');

describe('chat member avatar migration', () => {
  it('returns only requested approved members’ avatar URLs to approved callers', () => {
    expect(migration).toContain(
      'FUNCTION public.get_member_chat_member_avatars(p_user_ids uuid[])',
    );
    expect(migration).toContain('RETURNS TABLE (id uuid, avatar_url text)');
    expect(migration).toContain('p.id = ANY(p_user_ids)');
    expect(migration).toContain("p.application_status = 'approved'");
    expect(migration).toContain("caller.application_status = 'approved'");
    expect(migration).toContain('SECURITY DEFINER');
  });

  it('does not grant anonymous execution or broaden direct profile access', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
    expect(migration).not.toMatch(/CREATE\s+POLICY.*profiles/i);
  });
});
