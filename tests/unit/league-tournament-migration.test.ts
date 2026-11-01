import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('integrated League Tournament migration', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/0062_integrated_league_tournaments.sql'),
    'utf8',
  );

  it('uses the existing doubles tournament and ladder identity for a shared league series', () => {
    expect(migration).toContain("competition_type IN ('ladder','league')");
    expect(migration).toContain('tournament_config jsonb');
    expect(migration).toContain('social_doubles_ladder_id');
    expect(migration).toContain('tournament_pairs ADD COLUMN IF NOT EXISTS league_team_id');
  });

  it('keeps established league partners fixed across event registrations', () => {
    expect(migration).toContain(
      'Established league members must register with their confirmed partner',
    );
  });

  it('creates historical and current standings without an invalid DELETE trigger condition', () => {
    expect(migration).toContain('league_standings_snapshots');
    expect(migration).toContain('league_current_standings');
    expect(migration).not.toMatch(/CREATE\s+TRIGGER[^;]*WHEN\s*\([^)]*NEW\./is);
    expect(migration).not.toContain('DELETE ON public.events FOR EACH ROW WHEN');
  });

  it('stores standings after each event using that event’s results and fixed teams', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0063_league_after_event_standings.sql'),
      'utf8',
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS standings_after jsonb');
    expect(migration).toContain('p_include_event AND e.id=p_before_event');
    expect(migration).toContain('p_include_event AND EXISTS');
    expect(migration).toContain('standings_after=EXCLUDED.standings_after');
  });

  it('allows fixed team members to submit a League match score safely', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0064_league_overview_scores.sql'),
      'utf8',
    );
    expect(migration).toContain('submit_league_match_score');
    expect(migration).toContain('Only players in these fixed League teams');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.submit_league_match_score');
  });

  it('qualifies participant relations in the pair validation trigger with an empty search path', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0065_fix_league_pair_creation_search_path.sql'),
      'utf8',
    );
    expect(migration).toContain("SECURITY DEFINER SET search_path = ''");
    expect(migration).toContain(
      'FROM public.tournament_participants p1,public.tournament_participants p2',
    );
    expect(migration).not.toMatch(
      /FROM\s+public\.tournament_participants\s+p1\s*,\s*tournament_participants\s+p2/i,
    );
  });

  it('fixes League teams when a pair is created and supports series-wide admin replacements', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0066_league_teams_fixed_on_pair_creation.sql'),
      'utf8',
    );
    expect(migration).toContain(
      'INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)',
    );
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.replace_league_team_member');
    expect(migration).toContain('e.starts_at>=v_event_start');
    expect(migration).toContain('Completed match-player rows remain untouched');
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS public.confirm_league_tournament_teams(uuid)',
    );
  });

  it('stores League court assignments by pair and requires each pair once per slot', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0067_league_team_court_assignments.sql'),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.league_event_court_assignments');
    expect(migration).toContain('save_league_event_court_assignments');
    expect(migration).toContain('Assign every active League team once in each slot');
  });

  it('requires active paid membership and exposes League pair eligibility for the admin selectors', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0068_league_pair_membership_eligibility.sql'),
      'utf8',
    );
    expect(migration).toContain('public.has_active_paid_membership(p.id)');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.league_event_pair_eligibility');
    expect(migration).toContain('League teams require players with active paid membership');
  });

  it('returns League member eligibility for the admin participant selector before registration', () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/0069_league_participant_member_selector_eligibility.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('RETURNS TABLE(user_id uuid,eligible boolean)');
    expect(migration).toContain('FROM public.profiles profile');
    expect(migration).toContain('public.has_active_paid_membership(profile.id)');
  });

  it('allows confirmed League court over-capacity assignments to be saved', () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/0070_allow_overfull_league_courts_with_warning.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('save_league_event_court_assignments');
    expect(migration).not.toContain('Each court can hold two League teams per slot');
  });
});
