import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/0053_tournament_public_skill_levels.sql'),
  'utf8',
);
const consolidated = readFileSync(
  join(process.cwd(), 'supabase/consolidated_migrations.sql'),
  'utf8',
);
const publicView = readFileSync(
  join(process.cwd(), 'components/tournament-public-view.tsx'),
  'utf8',
);

describe('public tournament skill-level display migration', () => {
  it('exposes skill ratings without adding participant contact fields to public views', () => {
    expect(migration).toContain('profile.tennis_skill_level');
    expect(migration).toContain('profile_a.tennis_skill_level AS player_one_skill_level');
    expect(migration).toContain('profile_b.tennis_skill_level AS player_two_skill_level');
    expect(migration).not.toContain('p.email');
    expect(migration).not.toContain('p.phone');
    expect(migration).not.toContain('SELECT p.user_id');
    expect(consolidated).toContain('-- BEGIN MIGRATION: 0053_tournament_public_skill_levels.sql');
    expect(consolidated).toContain(migration.trim());
  });

  it('renders available skill ratings beside tournament participant names', () => {
    expect(publicView).toContain('participant.tennis_skill_level');
    expect(publicView).toContain('pair.player_one_skill_level');
    expect(publicView).toContain('pair.player_two_skill_level');
    expect(publicView).toContain('aria-label="Registered entries"');
  });
});
