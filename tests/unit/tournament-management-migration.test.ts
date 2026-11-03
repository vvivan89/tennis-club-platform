import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migration_archive/0048_tournament_management.sql'),
  'utf8',
);
const consolidated = readFileSync(
  join(process.cwd(), 'supabase/consolidated_migrations.sql'),
  'utf8',
);
const form = readFileSync(join(process.cwd(), 'components/event-management-form.tsx'), 'utf8');
const management = readFileSync(
  join(process.cwd(), 'components/tournament-management.tsx'),
  'utf8',
);
const publicView = readFileSync(
  join(process.cwd(), 'components/tournament-public-view.tsx'),
  'utf8',
);
const rankings = readFileSync(join(process.cwd(), 'lib/rankings-data.ts'), 'utf8');
const realtimeMigration = readFileSync(
  join(process.cwd(), 'supabase/migration_archive/0050_tournament_realtime_publication.sql'),
  'utf8',
);
const genderEligibilityMigration = readFileSync(
  join(process.cwd(), 'supabase/migration_archive/0051_tournament_gender_eligibility.sql'),
  'utf8',
);
const publicGenderOverrideMigration = readFileSync(
  join(process.cwd(), 'supabase/migration_archive/0052_tournament_public_gender_override.sql'),
  'utf8',
);

describe('tournament management foundation', () => {
  it('adds isolated tournament data tables and enables row-level security', () => {
    for (const table of [
      'tournament_teams',
      'tournament_participants',
      'tournament_pairs',
      'tournament_matches',
      'tournament_match_players',
      'tournament_audit_log',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it('keeps participant contacts out of public tournament views and blocks regular tournament score entry', () => {
    expect(migration).toContain('tournament_public_participants');
    expect(migration).toContain('p.display_name');
    expect(migration).not.toContain(
      'SELECT p.id, p.event_id, p.team_id, p.category, p.display_name, p.email',
    );
    expect(migration).toContain("e.event_type<>'tournament'");
    expect(migration).toContain('guard_captain_tournament_score_edit');
    expect(migration).toContain('tournament_ranked_sets');
    expect(migration).toContain(
      'REVOKE ALL ON public.tournament_ranked_sets FROM PUBLIC, anon, authenticated',
    );
  });

  it('supports tournament formats, scoring configuration, rules, group draws and public competition tabs', () => {
    expect(form).toContain('Doubles tournament');
    expect(form).toContain('Team tournament');
    expect(form).toContain('RichTextEditor');
    expect(form).toContain('team_two_sets_bonus_third');
    expect(form).toContain('two_sets_then_third');
    expect(management).toContain('Random group draw');
    expect(management).toContain('Random draw');
    expect(management).toContain('Suggest schedule');
    expect(publicView).toContain('Group standings');
    expect(publicView).toContain('Your next match');
    expect(rankings).toContain("from('tournament_ranked_sets')");
  });

  it('keeps category schedules isolated while checking shared player identities for schedule conflicts', () => {
    expect(management).toContain('user:${participant.user_id}');
    expect(management).toContain('email:${participant.email.trim().toLowerCase()}');
    expect(management).toContain('playerConflict');
    expect(management).toContain('Winner of ${knockoutStageLabel');
    expect(management).not.toContain('window.confirm(');
    expect(publicView).toContain('Knockout bracket');
    expect(publicView).toContain('Promoted');
  });

  it('schedules tournament phases after prerequisites and keeps bracket headings aligned independently of match tiles', () => {
    const scheduleStart = management.indexOf('async function generateSchedule()');
    const scheduleEnd = management.indexOf(
      'async function syncUnplayedRoundRobinMatches()',
      scheduleStart,
    );
    const roundRobinPrerequisites = management.indexOf("? ['preliminary_knockout']", scheduleStart);
    expect(scheduleStart).toBeGreaterThanOrEqual(0);
    expect(scheduleEnd).toBeGreaterThan(scheduleStart);
    expect(roundRobinPrerequisites).toBeGreaterThan(scheduleStart);
    expect(management.slice(scheduleStart, scheduleEnd)).toContain(
      'phaseStartAfterPrerequisites({',
    );

    const drawStart = management.indexOf('async function randomizeKnockoutDraw()');
    const prerequisiteSchedule = management.indexOf('phaseStartAfterPrerequisites({', drawStart);
    const knockoutSchedule = management.indexOf(
      'const knockoutAssignments = buildKnockoutSchedule({',
      drawStart,
    );
    expect(drawStart).toBeGreaterThanOrEqual(0);
    expect(prerequisiteSchedule).toBeGreaterThan(drawStart);
    expect(knockoutSchedule).toBeGreaterThan(prerequisiteSchedule);
    expect(management.slice(drawStart, knockoutSchedule)).toContain(
      "'preliminary_knockout', 'round_robin'",
    );
    expect(management.slice(knockoutSchedule, knockoutSchedule + 500)).toContain(
      'baseStart: phaseStart',
    );
    expect(publicView).toContain(
      'absolute left-0 top-0 h-5 text-xs font-semibold uppercase leading-5 tracking-wide',
    );
    expect(publicView).toContain(
      'style={{ width: `${bracketWidth}px`, height: `${bracketHeight}px` }}',
    );
  });

  it('publishes tournament tables to realtime for live view updates', () => {
    expect(realtimeMigration).toContain('alter publication supabase_realtime add table');
    expect(realtimeMigration).toContain('bump_tournament_event_updated_at');
    for (const table of [
      'events',
      'tournament_participants',
      'tournament_pairs',
      'tournament_matches',
      'tournament_match_players',
    ])
      expect(realtimeMigration).toContain(table);
    expect(consolidated).toContain('-- BEGIN MIGRATION: 0050_tournament_realtime_publication.sql');
    expect(consolidated).toContain(realtimeMigration.trim());
  });

  it('enforces known gender eligibility server-side while allowing unspecified gender', () => {
    expect(genderEligibilityMigration).toContain("v_gender IS NOT NULL AND v_gender<>'male'");
    expect(genderEligibilityMigration).toContain("v_gender IS NOT NULL AND v_gender<>'female'");
    expect(genderEligibilityMigration).toContain(
      "v_gender IS NOT NULL AND v_gender NOT IN ('male','female')",
    );
    expect(consolidated).toContain('-- BEGIN MIGRATION: 0051_tournament_gender_eligibility.sql');
    expect(consolidated).toContain(genderEligibilityMigration.trim());
  });

  it('uses tournament-specific gender overrides for public category eligibility without exposing contact fields', () => {
    expect(publicGenderOverrideMigration).toContain(
      'coalesce(p.gender_override, p.gender) AS gender',
    );
    expect(publicGenderOverrideMigration).not.toContain('p.email');
    expect(consolidated).toContain(
      '-- BEGIN MIGRATION: 0052_tournament_public_gender_override.sql',
    );
    expect(consolidated).toContain(publicGenderOverrideMigration.trim());
  });

  it('keeps the incremental migration represented in the consolidated schema', () => {
    expect(consolidated).toContain('-- BEGIN MIGRATION: 0048_tournament_management.sql');
    expect(consolidated).toContain('-- END MIGRATION: 0048_tournament_management.sql');
    expect(consolidated).toContain(migration.trim());
  });
});
