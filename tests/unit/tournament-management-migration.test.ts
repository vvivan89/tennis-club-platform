import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migration_archive/0048_tournament_management.sql'),
  'utf8',
);
const form = ['components/event-management-form.tsx', 'components/event-form-defaults.ts']
  .map((path) => readFileSync(join(process.cwd(), path), 'utf8'))
  .join('\n');
const competitionFields = readFileSync(
  join(process.cwd(), 'components/event-competition-fields.tsx'),
  'utf8',
);
const management = readFileSync(
  join(process.cwd(), 'components/tournament-management.tsx'),
  'utf8',
);
const publicView = readFileSync(
  join(process.cwd(), 'components/tournament-public-view.tsx'),
  'utf8',
);
const publicOverview = readFileSync(
  join(process.cwd(), 'components/tournament-overview-panel.tsx'),
  'utf8',
);
const participantManagement = readFileSync(
  join(process.cwd(), 'components/tournament-participant-management-panel.tsx'),
  'utf8',
);
const matchManagement = readFileSync(
  join(process.cwd(), 'components/tournament-match-management-panel.tsx'),
  'utf8',
);
const matchActions = readFileSync(
  join(process.cwd(), 'components/use-tournament-match-actions.ts'),
  'utf8',
);
const publicGroupStandings = readFileSync(
  join(process.cwd(), 'components/tournament-public-group-standings-panel.tsx'),
  'utf8',
);
const publicCompetitionResults = readFileSync(
  join(process.cwd(), 'components/tournament-competition-results.tsx'),
  'utf8',
);
const drawActions = readFileSync(
  join(process.cwd(), 'components/use-tournament-draw-actions.ts'),
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
    expect(competitionFields).toContain('RichTextEditor');
    expect(form).toContain('team_two_sets_bonus_third');
    expect(form).toContain('two_sets_then_third');
    expect(participantManagement).toContain('Random group draw');
    expect(matchManagement).toContain('Create draw');
    expect(matchManagement).toContain('Suggest schedule');
    expect(publicGroupStandings).toContain('Group standings');
    expect(publicOverview).toContain('Your next match');
    expect(rankings).toContain("from('tournament_ranked_sets')");
  });

  it('keeps category schedules isolated while checking shared player identities for schedule conflicts', () => {
    expect(matchActions).toContain('user:${participant.user_id}');
    expect(matchActions).toContain('email:${participant.email.trim().toLowerCase()}');
    expect(matchActions).toContain('playerConflict');
    expect(matchManagement).toContain('Winner of ${knockoutStageLabel');
    expect(management).not.toContain('window.confirm(');
    expect(publicCompetitionResults).toContain('Knockout bracket');
    expect(publicGroupStandings).toContain('Promoted');
  });

  it('schedules tournament phases after prerequisites and keeps bracket headings aligned independently of match tiles', () => {
    const scheduleStart = matchActions.indexOf('async function generateSchedule()');
    const roundRobinPrerequisites = matchActions.indexOf(
      "? ['preliminary_knockout']",
      scheduleStart,
    );
    expect(scheduleStart).toBeGreaterThanOrEqual(0);
    expect(roundRobinPrerequisites).toBeGreaterThan(scheduleStart);
    expect(matchActions.slice(scheduleStart)).toContain('phaseStartAfterPrerequisites({');

    const drawStart = drawActions.indexOf('async function randomizeKnockoutDraw()');
    const prerequisiteSchedule = drawActions.indexOf('phaseStartAfterPrerequisites({', drawStart);
    const knockoutSchedule = drawActions.indexOf(
      'const knockoutAssignments = buildKnockoutSchedule({',
      drawStart,
    );
    expect(drawStart).toBeGreaterThanOrEqual(0);
    expect(prerequisiteSchedule).toBeGreaterThan(drawStart);
    expect(knockoutSchedule).toBeGreaterThan(prerequisiteSchedule);
    expect(drawActions.slice(drawStart, knockoutSchedule)).toContain(
      "'preliminary_knockout', 'round_robin'",
    );
    expect(drawActions.slice(knockoutSchedule, knockoutSchedule + 500)).toContain(
      'baseStart: phaseStart',
    );
    expect(publicCompetitionResults).toContain(
      'absolute left-0 top-0 h-5 text-xs font-semibold uppercase leading-5 tracking-wide',
    );
    expect(publicCompetitionResults).toContain(
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
  });

  it('enforces known gender eligibility server-side while allowing unspecified gender', () => {
    expect(genderEligibilityMigration).toContain("v_gender IS NOT NULL AND v_gender<>'male'");
    expect(genderEligibilityMigration).toContain("v_gender IS NOT NULL AND v_gender<>'female'");
    expect(genderEligibilityMigration).toContain(
      "v_gender IS NOT NULL AND v_gender NOT IN ('male','female')",
    );
  });

  it('uses tournament-specific gender overrides for public category eligibility without exposing contact fields', () => {
    expect(publicGenderOverrideMigration).toContain(
      'coalesce(p.gender_override, p.gender) AS gender',
    );
    expect(publicGenderOverrideMigration).not.toContain('p.email');
  });

  it('keeps the tournament foundation in the historical migration archive', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.tournament_matches');
    expect(migration).toContain(
      'ALTER TABLE public.tournament_audit_log ENABLE ROW LEVEL SECURITY',
    );
  });
});
