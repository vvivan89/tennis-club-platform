-- Approved club members can view full tournament details before registering,
-- including team tournaments. Public visitors and event-only accounts retain
-- the existing visibility rules.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  (p.user_id IS NOT NULL) AS is_member
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered' AND p.confirmation_status='confirmed'
  AND (p.user_id IS NULL OR (profile.application_status='approved' AND profile.account_kind='member')
    OR profile.account_kind='event_guest')
  AND (e.tournament_details_public=true
    OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
      AND viewer.application_status='approved' AND viewer.account_kind='member')
    OR (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
        AND own.user_id=auth.uid() AND own.status='registered'
    )));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id,p.event_id,p.category,p.player_one_id,p.player_two_id,p.group_number,p.seed,p.status,
  a.display_name AS player_one_name,b.display_name AS player_two_name,
  coalesce(a.tennis_skill_level::text,profile_a.tennis_skill_level) AS player_one_skill_level,
  coalesce(b.tennis_skill_level::text,profile_b.tennis_skill_level) AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id AND a.status='registered'
  AND a.confirmation_status='confirmed'
JOIN public.tournament_participants b ON b.id=p.player_two_id AND b.status='registered'
  AND b.confirmation_status='confirmed'
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published'
  AND (a.user_id IS NULL OR (profile_a.application_status='approved' AND profile_a.account_kind='member')
    OR profile_a.account_kind='event_guest')
  AND (b.user_id IS NULL OR (profile_b.application_status='approved' AND profile_b.account_kind='member')
    OR profile_b.account_kind='event_guest')
  AND (e.tournament_details_public=true
    OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
      AND viewer.application_status='approved' AND viewer.account_kind='member')
    OR (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
        AND own.user_id=auth.uid() AND own.status='registered'
    )));

CREATE OR REPLACE VIEW public.tournament_public_teams AS
SELECT t.id,t.event_id,t.name,t.logo_url,t.color,t.group_number,t.captain_user_id,
  CASE WHEN captain.application_status='approved' AND captain.account_kind='member'
    THEN captain.full_name ELSE NULL END AS captain_name
FROM public.tournament_teams t
LEFT JOIN public.profiles captain ON captain.id=t.captain_user_id
JOIN public.events e ON e.id=t.event_id
WHERE e.status='published' AND (e.tournament_details_public=true
  OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
    AND viewer.application_status='approved' AND viewer.account_kind='member')
  OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
      AND own.user_id=auth.uid() AND own.status='registered'
  )));

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id,m.event_id,m.category,m.phase,m.group_number,m.round_number,m.match_number,
  m.pair_one_id,m.pair_two_id,m.team_one_id,m.team_two_id,m.scheduled_at,m.court_number,
  m.score_sets,m.winner_side,m.team_points_one,m.team_points_two,m.status,m.notes,
  team_one.name AS team_one_name,team_two.name AS team_two_name,
  coalesce(side_one.players,pair_one.player_one_name || ' + ' || pair_one.player_two_name) AS player_one_name,
  NULL::text AS player_two_name,
  coalesce(side_two.players,pair_two.player_one_name || ' + ' || pair_two.player_two_name) AS opponent_one_name,
  NULL::text AS opponent_two_name
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.status='published'
LEFT JOIN public.tournament_teams team_one ON team_one.id=m.team_one_id
LEFT JOIN public.tournament_teams team_two ON team_two.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs pair_one ON pair_one.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs pair_two ON pair_two.id=m.pair_two_id
LEFT JOIN LATERAL (
  SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players
  FROM public.tournament_match_players mp
  JOIN public.tournament_participants p ON p.id=mp.participant_id
  LEFT JOIN public.profiles profile ON profile.id=p.user_id
  WHERE mp.match_id=m.id AND mp.side=1
    AND (p.user_id IS NULL OR (profile.application_status='approved' AND profile.account_kind='member')
      OR profile.account_kind='event_guest')
) side_one ON true
LEFT JOIN LATERAL (
  SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players
  FROM public.tournament_match_players mp
  JOIN public.tournament_participants p ON p.id=mp.participant_id
  LEFT JOIN public.profiles profile ON profile.id=p.user_id
  WHERE mp.match_id=m.id AND mp.side=2
    AND (p.user_id IS NULL OR (profile.application_status='approved' AND profile.account_kind='member')
      OR profile.account_kind='event_guest')
) side_two ON true
WHERE e.tournament_details_public=true
  OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
    AND viewer.application_status='approved' AND viewer.account_kind='member')
  OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
      AND own.user_id=auth.uid() AND own.status='registered'
  ));
