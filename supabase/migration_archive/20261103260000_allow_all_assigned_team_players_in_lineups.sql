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
  v_team_captain_user_id uuid;
  v_side smallint;
  v_one_gender text;
  v_two_gender text;
BEGIN
  SELECT match.*
  INTO v_match
  FROM public.tournament_matches match
  JOIN public.tournament_teams team
    ON team.id=p_team_id
   AND team.event_id=match.event_id
  WHERE match.id=p_match_id
    AND (match.team_one_id=p_team_id OR match.team_two_id=p_team_id)
    AND match.status NOT IN ('completed','cancelled');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You cannot edit this match lineup';
  END IF;
  SELECT team.captain_user_id INTO v_team_captain_user_id
  FROM public.tournament_teams team
  WHERE team.id=p_team_id AND team.event_id=v_match.event_id;
  IF NOT public.is_event_manager() AND v_team_captain_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only this team captain or an event manager can edit the lineup';
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
    AND (one.team_id=p_team_id OR (one.team_id IS NULL AND one.user_id=v_team_captain_user_id))
    AND (two.team_id=p_team_id OR (two.team_id IS NULL AND two.user_id=v_team_captain_user_id))
    AND one.status='registered' AND two.status='registered'
    AND one.confirmation_status='confirmed' AND two.confirmation_status='confirmed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Both players must be confirmed members of this team roster';
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

  UPDATE public.tournament_participants
  SET team_id=p_team_id,updated_at=now()
  WHERE id IN (p_player_one,p_player_two)
    AND team_id IS NULL
    AND user_id=v_team_captain_user_id;

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
