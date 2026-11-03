import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migration_archive/0037_chat_presence_cleanup_pagination.sql',
  'utf8',
);

describe('chat cleanup, presence, and unread-query migration', () => {
  it('indexes the unread-count filter and publishes read-marker changes', () => {
    expect(migration).toMatch(
      /member_chat_messages_unread_idx[\s\S]*?ON public\.member_chat_messages \(created_at, id, user_id\)/i,
    );
    expect(migration).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.member_chat_reads/i,
    );
    expect(migration).toMatch(/FUNCTION public\.get_member_chat_unread_count\(\)/i);
    expect(migration).toMatch(/\(m\.created_at, m\.id\) > \(r\.last_read_at/i);
  });

  it('queues image paths for storage deletion when messages are deleted or pruned', () => {
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.member_chat_image_cleanup_queue/i,
    );
    expect(migration).toMatch(/AFTER DELETE ON public\.member_chat_messages/i);
    expect(migration).toMatch(
      /INSERT INTO public\.member_chat_image_cleanup_queue \(image_path\)/i,
    );
  });

  it('allows retention pruning without relaxing the normal five-minute deletion rule', () => {
    expect(migration).toMatch(
      /current_setting\('pctc\.chat_history_prune', true\) IS DISTINCT FROM 'on'/i,
    );
    expect(migration).toMatch(/set_config\('pctc\.chat_history_prune', 'on', true\)/i);
    expect(migration).toMatch(/OLD\.created_at < now\(\) - interval '5 minutes'/i);
  });
});
