ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS team_one_lineup_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS team_two_lineup_public boolean NOT NULL DEFAULT false;

UPDATE public.events event
SET tournament_config=jsonb_set(
  coalesce(event.tournament_config,'{}'::jsonb),
  '{categories}',
  '["mixed","men","women"]'::jsonb,
  true
)
WHERE event.event_type='tournament' AND event.tournament_format='team'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(event.tournament_config->'categories')='array'
        THEN event.tournament_config->'categories' ELSE '[]'::jsonb END
    ) category
    WHERE category IN ('mixed','men','women')
  );

-- Older team matches used the synthetic "team" category. Preserve them under
-- the first configured gender category so they remain visible after segmentation.
UPDATE public.tournament_matches match
SET category=CASE
  WHEN event.tournament_config->'categories'->>0 IN ('mixed','men','women')
    THEN event.tournament_config->'categories'->>0
  WHEN event.tournament_config->'categories'->>1 IN ('mixed','men','women')
    THEN event.tournament_config->'categories'->>1
  ELSE 'mixed'
END
FROM public.events event
WHERE event.id=match.event_id AND event.tournament_format='team' AND match.category='team';

CREATE OR REPLACE FUNCTION public.guard_captain_tournament_score_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_captain_team uuid;
  v_allowed text[];
BEGIN
  SELECT team.id INTO v_captain_team
  FROM public.tournament_teams team
  WHERE team.event_id=OLD.event_id AND team.captain_user_id=auth.uid()
    AND team.id IN (OLD.team_one_id,OLD.team_two_id)
  LIMIT 1;
  IF v_captain_team IS NOT NULL AND NOT public.is_event_manager() THEN
    v_allowed := ARRAY['score_sets','winner_side','team_points_one','team_points_two','status','entered_by','updated_at'];
    IF v_captain_team=OLD.team_one_id THEN
      v_allowed := array_append(v_allowed,'team_one_lineup_public');
    ELSE
      v_allowed := array_append(v_allowed,'team_two_lineup_public');
    END IF;
    IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
      RAISE EXCEPTION 'Team captains may only edit match results and their own lineup visibility';
    END IF;
    NEW.entered_by := auth.uid();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_tournament_player_to_captain_team(p_participant_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_id uuid;
  v_event_id uuid;
BEGIN
  SELECT team.id,team.event_id INTO v_team_id,v_event_id
  FROM public.tournament_teams team
  JOIN public.events event ON event.id=team.event_id
  WHERE team.captain_user_id=auth.uid()
    AND event.tournament_format='team'
    AND event.event_type='tournament'
    AND event.status='published'
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'You must be the captain of a published team tournament team';
  END IF;

  UPDATE public.tournament_participants participant
  SET team_id=v_team_id,updated_at=now()
  WHERE participant.id=p_participant_id
    AND participant.event_id=v_event_id
    AND participant.status='registered'
    AND participant.confirmation_status='confirmed'
    AND participant.team_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This player is not an unassigned registered player for your tournament';
  END IF;
  RETURN v_team_id;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_tournament_player_to_captain_team(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_tournament_player_to_captain_team(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_tournament_captain_match_lineup(
  p_match_id uuid,
  p_team_id uuid,
  p_player_one uuid,
  p_player_two uuid,
  p_visible_to_public boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_match public.tournament_matches%rowtype;
  v_event public.events%rowtype;
  v_side smallint;
  v_one_gender text;
  v_two_gender text;
BEGIN
  SELECT match.* INTO v_match
  FROM public.tournament_matches match
  JOIN public.tournament_teams team
    ON team.id=p_team_id
   AND team.event_id=match.event_id
   AND team.captain_user_id=auth.uid()
  WHERE match.id=p_match_id
    AND (match.team_one_id=p_team_id OR match.team_two_id=p_team_id)
    AND match.status NOT IN ('completed','cancelled');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You cannot edit this match lineup';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_match.event_id;
  IF v_event.tournament_format<>'team' OR v_match.category NOT IN ('mixed','men','women')
     OR NOT (coalesce(v_event.tournament_config->'categories','["mixed","men","women"]'::jsonb) ? v_match.category) THEN
    RAISE EXCEPTION 'This match category is not enabled for the tournament';
  END IF;
  IF p_player_one=p_player_two THEN
    RAISE EXCEPTION 'Select two different players for the match';
  END IF;
  SELECT
    CASE WHEN lower(coalesce(one.gender_override,one.gender,'')) IN ('male','man','men','m') THEN 'male'
         WHEN lower(coalesce(one.gender_override,one.gender,'')) IN ('female','woman','women','f') THEN 'female' END,
    CASE WHEN lower(coalesce(two.gender_override,two.gender,'')) IN ('male','man','men','m') THEN 'male'
         WHEN lower(coalesce(two.gender_override,two.gender,'')) IN ('female','woman','women','f') THEN 'female' END
  INTO v_one_gender,v_two_gender
  FROM public.tournament_participants one,public.tournament_participants two
  WHERE one.id=p_player_one AND two.id=p_player_two
    AND one.event_id=v_match.event_id AND two.event_id=v_match.event_id
    AND one.team_id=p_team_id AND two.team_id=p_team_id
    AND one.status='registered' AND two.status='registered'
    AND one.confirmation_status='confirmed' AND two.confirmation_status='confirmed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Both players must be confirmed members of your team roster';
  END IF;
  IF v_match.category='men' AND (v_one_gender IS DISTINCT FROM 'male' OR v_two_gender IS DISTINCT FROM 'male') THEN
    RAISE EXCEPTION 'Men’s matches require two male players';
  ELSIF v_match.category='women' AND (v_one_gender IS DISTINCT FROM 'female' OR v_two_gender IS DISTINCT FROM 'female') THEN
    RAISE EXCEPTION 'Women’s matches require two female players';
  ELSIF v_match.category='mixed'
    AND NOT coalesce((v_one_gender='male' AND v_two_gender='female')
      OR (v_one_gender='female' AND v_two_gender='male'),false) THEN
    RAISE EXCEPTION 'Mixed matches require one male and one female player';
  END IF;

  v_side := CASE WHEN v_match.team_one_id=p_team_id THEN 1 ELSE 2 END;
  DELETE FROM public.tournament_match_players
  WHERE match_id=p_match_id AND team_id=p_team_id;
  INSERT INTO public.tournament_match_players(match_id,participant_id,side,team_id)
  VALUES (p_match_id,p_player_one,v_side,p_team_id),(p_match_id,p_player_two,v_side,p_team_id);
  UPDATE public.tournament_matches
  SET team_one_lineup_public=CASE WHEN v_side=1 THEN p_visible_to_public ELSE team_one_lineup_public END,
      team_two_lineup_public=CASE WHEN v_side=2 THEN p_visible_to_public ELSE team_two_lineup_public END,
      updated_at=now()
  WHERE id=p_match_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_tournament_captain_match_lineup(uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_tournament_captain_match_lineup(uuid,uuid,uuid,uuid,boolean) TO authenticated;

DROP POLICY IF EXISTS "Captains manage their match pairings" ON public.tournament_match_players;
DROP POLICY IF EXISTS "Public read published tournament match players" ON public.tournament_match_players;
CREATE POLICY "Public read published tournament match players" ON public.tournament_match_players
FOR SELECT TO anon,authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.tournament_matches match
    JOIN public.events event ON event.id=match.event_id
    WHERE match.id=match_id
      AND event.status='published'
      AND (
        public.is_event_manager()
        OR (
          (event.tournament_details_public=true
            OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
              AND viewer.application_status='approved' AND viewer.account_kind='member')
            OR EXISTS (SELECT 1 FROM public.tournament_participants own
              WHERE own.event_id=event.id AND own.user_id=auth.uid() AND own.status='registered'))
          AND (
            tournament_match_players.team_id IS NULL
            OR (tournament_match_players.side=1 AND match.team_one_lineup_public)
            OR (tournament_match_players.side=2 AND match.team_two_lineup_public)
          )
        )
      )
  )
);
DROP POLICY IF EXISTS "Captains read their own match lineups" ON public.tournament_match_players;
CREATE POLICY "Captains read their own match lineups" ON public.tournament_match_players
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.tournament_matches match
    JOIN public.tournament_teams team ON team.event_id=match.event_id
    WHERE match.id=match_id AND team.id=tournament_match_players.team_id
      AND team.captain_user_id=auth.uid()
      AND team.id=CASE WHEN tournament_match_players.side=1 THEN match.team_one_id ELSE match.team_two_id END
  )
);

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id,m.event_id,m.category,m.phase,m.group_number,m.round_number,m.match_number,
  m.pair_one_id,m.pair_two_id,m.team_one_id,m.team_two_id,m.scheduled_at,m.court_number,
  m.score_sets,m.winner_side,m.team_points_one,m.team_points_two,m.status,m.notes,
  team_one.name AS team_one_name,team_two.name AS team_two_name,
  CASE WHEN public.is_event_manager() OR m.team_one_lineup_public
       THEN coalesce(side_one.players,pair_one.player_one_name || ' + ' || pair_one.player_two_name)
       ELSE coalesce(pair_one.player_one_name || ' + ' || pair_one.player_two_name,'') END AS player_one_name,
  NULL::text AS player_two_name,
  CASE WHEN public.is_event_manager() OR m.team_two_lineup_public
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
