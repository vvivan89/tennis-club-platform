import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261117150000_tennis_skill_restrictions.sql'),
  'utf8',
);

describe('event tennis skill restriction migration', () => {
  it('stores optional ranges on persistent Ladder and League identities', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS minimum_tennis_skill_level');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS maximum_tennis_skill_level');
    expect(migration).toContain('social_doubles_ladders_skill_range_check');
  });

  it('enforces ranges on doubles tournament entries and social Ladder registrations', () => {
    expect(migration).toContain('enforce_tournament_participant_skill_range');
    expect(migration).toContain('enforce_ladder_registration_skill_range');
    expect(migration).toContain("v_format IS DISTINCT FROM 'doubles'");
    expect(migration).toContain("event.event_type = 'social_doubles_ladder'");
  });

  it('syncs League skill limits into every linked event configuration', () => {
    expect(migration).toContain(
      'OLD.minimum_tennis_skill_level IS DISTINCT FROM NEW.minimum_tennis_skill_level',
    );
    expect(migration).toContain("'maximum_tennis_skill_level', NEW.maximum_tennis_skill_level");
  });
});
