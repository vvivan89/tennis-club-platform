import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Social Doubles Ladder migration', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'supabase/migration_archive/0058_social_doubles_ladder.sql'),
    'utf8',
  );
  it('keeps ladders gender-specific and stores configurable scoring', () => {
    expect(migration).toContain("gender in ('male','female')");
    expect(migration).toContain('position_points integer[]');
    expect(migration).toContain('ranking_priority text[]');
  });
  it('links ladder sessions to a persistent ladder', () => {
    expect(migration).toContain(
      'social_doubles_ladder_id uuid references public.social_doubles_ladders(id)',
    );
    expect(migration).toContain('carryover_mode');
    expect(migration).toContain('previous_ladder_id');
  });
});
