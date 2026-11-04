CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id,m.event_id,m.category,m.phase,m.group_number,m.round_number,m.match_number,
  m.pair_one_id,m.pair_two_id,m.team_one_id,m.team_two_id,m.scheduled_at,m.court_number,
  m.score_sets,m.winner_side,m.team_points_one,m.team_points_two,m.status,m.notes,
  team_one.name AS team_one_name,team_two.name AS team_two_name,
  CASE WHEN public.is_event_manager() OR m.team_one_lineup_public
         OR now() >= coalesce(m.scheduled_at,e.starts_at) OR EXISTS (
         SELECT 1
         FROM public.tournament_participants member
         WHERE member.event_id=m.event_id AND member.team_id=m.team_one_id
           AND member.user_id=(SELECT auth.uid())
           AND member.status='registered' AND member.confirmation_status='confirmed'
       )
       THEN coalesce(side_one.players,pair_one.player_one_name || ' + ' || pair_one.player_two_name)
       ELSE coalesce(pair_one.player_one_name || ' + ' || pair_one.player_two_name,'') END AS player_one_name,
  NULL::text AS player_two_name,
  CASE WHEN public.is_event_manager() OR m.team_two_lineup_public
         OR now() >= coalesce(m.scheduled_at,e.starts_at) OR EXISTS (
         SELECT 1
         FROM public.tournament_participants member
         WHERE member.event_id=m.event_id AND member.team_id=m.team_two_id
           AND member.user_id=(SELECT auth.uid())
           AND member.status='registered' AND member.confirmation_status='confirmed'
       )
       THEN coalesce(side_two.players,pair_two.player_one_name || ' + ' || pair_two.player_two_name)
       ELSE coalesce(pair_two.player_one_name || ' + ' || pair_two.player_two_name,'') END AS opponent_one_name,
  NULL::text AS opponent_two_name,
  m.team_one_lineup_public,m.team_two_lineup_public
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
  OR EXISTS (SELECT 1 FROM public.tournament_participants own
    WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered');

GRANT SELECT ON public.tournament_public_matches TO anon,authenticated;
