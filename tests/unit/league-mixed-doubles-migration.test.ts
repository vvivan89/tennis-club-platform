import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261117100000_mixed_doubles_ladders_and_leagues.sql'),
  'utf8',
);
const adminRegistrationMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261117110000_allow_admin_league_single_participants.sql',
  ),
  'utf8',
);
const adminGenderOverrideMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261117120000_allow_admin_event_gender_override.sql'),
  'utf8',
);

describe('Mixed doubles database enforcement', () => {
  it('allows mixed configuration while keeping League category and team validation server-side', () => {
    expect(migration).toContain("CHECK (gender IN ('male', 'female', 'mixed'))");
    expect(migration).toContain("ELSE 'mixed' END");
    expect(migration).toContain(
      'Mixed League teams require exactly one male and one female player',
    );
  });

  it('requires opposite binary genders for both sides of a Mixed Ladder score', () => {
    expect(migration).toContain(
      'Each Mixed Ladder doubles side requires exactly one male and one female player',
    );
    expect(migration).toContain("event.event_type = 'social_doubles_ladder'");
  });

  it('allows admins to add unpaired League members through the discounted registration path', () => {
    expect(adminRegistrationMigration).toContain("competition_type = 'league'");
    expect(adminRegistrationMigration).toContain(
      'League participants must use the League doubles category',
    );
    expect(adminRegistrationMigration).toContain('public.has_active_paid_membership(v_user_id)');
    expect(adminRegistrationMigration).not.toContain(
      'This admin registration path is only available for standalone tournaments',
    );
  });

  it('uses an event-only admin gender override when the member profile has no gender', () => {
    expect(adminGenderOverrideMigration).toContain(
      'v_gender := coalesce(v_profile.gender, p_gender)',
    );
  });
});
