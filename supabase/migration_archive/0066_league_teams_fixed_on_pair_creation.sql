-- League teams begin when the first pair is created; replacements update the team series-wide.
BEGIN;

CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text; v_one uuid; v_two uuid; v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender
  FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id INTO v_one,v_two
  FROM public.tournament_participants p1,public.tournament_participants p2
  WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF v_one IS NULL OR v_two IS NULL THEN RAISE EXCEPTION 'League teams require two approved member accounts'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two) AND p.application_status<>'approved') THEN
    RAISE EXCEPTION 'League participants must be approved members';
  END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two) OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after the pair is created';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  ELSE
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
    VALUES(v_league,v_one,v_two) RETURNING * INTO v_member_team;
    NEW.league_team_id := v_member_team.id;
  END IF;
  RETURN NEW;
END; $$;

-- Give existing unlinked League pairs the same fixed-team behavior after upgrade.
INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
SELECT DISTINCT ON (e.social_doubles_ladder_id,least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id))
  e.social_doubles_ladder_id,p1.user_id,p2.user_id
FROM public.tournament_pairs pair
JOIN public.events e ON e.id=pair.event_id AND e.event_type='tournament' AND e.tournament_format='doubles'
JOIN public.social_doubles_ladders league ON league.id=e.social_doubles_ladder_id AND league.competition_type='league'
JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
WHERE pair.status='active' AND pair.league_team_id IS NULL AND p1.user_id IS NOT NULL AND p2.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=e.social_doubles_ladder_id AND t.status='active'
    AND (t.player_one_id IN (p1.user_id,p2.user_id) OR t.player_two_id IN (p1.user_id,p2.user_id)))
ORDER BY e.social_doubles_ladder_id,least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id),pair.created_at,pair.id;

UPDATE public.tournament_pairs pair SET league_team_id=team.id
FROM public.events e,public.tournament_participants p1,public.tournament_participants p2,public.league_teams team
WHERE pair.league_team_id IS NULL AND pair.status='active' AND e.id=pair.event_id
  AND e.social_doubles_ladder_id=team.league_id AND team.status='active'
  AND p1.id=pair.player_one_id AND p2.id=pair.player_two_id
  AND ((team.player_one_id=p1.user_id AND team.player_two_id=p2.user_id)
    OR (team.player_one_id=p2.user_id AND team.player_two_id=p1.user_id));

DROP FUNCTION IF EXISTS public.confirm_league_tournament_teams(uuid);

CREATE OR REPLACE FUNCTION public.replace_league_team_member(
  p_event_id uuid,
  p_pair_id uuid,
  p_side integer,
  p_replacement_participant_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_league_id uuid;
  v_team_id uuid;
  v_event_start timestamptz;
  v_old_user uuid;
  v_new_user uuid;
  v_category text;
BEGIN
  IF p_side NOT IN (1,2) THEN RAISE EXCEPTION 'Pair side must be 1 or 2'; END IF;
  SELECT e.social_doubles_ladder_id,e.starts_at,p.league_team_id,p.category,
    old_player.user_id,replacement.user_id
  INTO v_league_id,v_event_start,v_team_id,v_category,v_old_user,v_new_user
  FROM public.events e
  JOIN public.tournament_pairs p ON p.event_id=e.id AND p.id=p_pair_id AND p.status='active'
  JOIN public.tournament_participants old_player ON old_player.id=CASE WHEN p_side=1 THEN p.player_one_id ELSE p.player_two_id END
  JOIN public.tournament_participants replacement ON replacement.id=p_replacement_participant_id AND replacement.event_id=e.id AND replacement.status='registered'
  WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles';

  IF v_league_id IS NULL OR v_team_id IS NULL OR NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF v_old_user IS NULL OR v_new_user IS NULL OR v_new_user=v_old_user THEN
    RAISE EXCEPTION 'Select a different registered replacement player';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_new_user AND p.application_status='approved') THEN
    RAISE EXCEPTION 'League participants must be approved members';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=v_league_id AND t.status='active' AND t.id<>v_team_id
    AND v_new_user IN (t.player_one_id,t.player_two_id)) THEN
    RAISE EXCEPTION 'Replacement player already belongs to another active league team';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_pairs p
    JOIN public.events e ON e.id=p.event_id AND e.social_doubles_ladder_id=v_league_id
    JOIN public.tournament_participants member ON member.id IN (p.player_one_id,p.player_two_id)
    WHERE p.status='active' AND p.league_team_id=v_team_id AND e.starts_at>=v_event_start
      AND member.user_id=v_new_user AND p.id<>p_pair_id) THEN
    RAISE EXCEPTION 'Replacement player is already assigned to another League pair';
  END IF;

  UPDATE public.league_teams
  SET player_one_id=CASE WHEN p_side=1 THEN v_new_user ELSE player_one_id END,
      player_two_id=CASE WHEN p_side=2 THEN v_new_user ELSE player_two_id END
  WHERE id=v_team_id AND league_id=v_league_id AND status='active';

  -- Update this and later event pairs where the replacement has a registration.
  -- Completed match-player rows remain untouched, preserving each player's prior match history.
  WITH replacement_rows AS (
    SELECT pair.id AS pair_id,pair.event_id,replacement.id AS participant_id,old_member.id AS old_participant_id
    FROM public.tournament_pairs pair
    JOIN public.events e ON e.id=pair.event_id AND e.social_doubles_ladder_id=v_league_id AND e.starts_at>=v_event_start
    JOIN public.tournament_participants old_member ON old_member.id=CASE WHEN p_side=1 THEN pair.player_one_id ELSE pair.player_two_id END
    JOIN public.tournament_participants replacement ON replacement.event_id=pair.event_id AND replacement.user_id=v_new_user
      AND replacement.category=v_category AND replacement.status='registered'
    WHERE pair.league_team_id=v_team_id AND pair.status='active'
      AND old_member.user_id=v_old_user
  ), changed AS (
    UPDATE public.tournament_pairs pair
    SET player_one_id=CASE WHEN p_side=1 THEN replacement_rows.participant_id ELSE pair.player_one_id END,
        player_two_id=CASE WHEN p_side=2 THEN replacement_rows.participant_id ELSE pair.player_two_id END
    FROM replacement_rows WHERE pair.id=replacement_rows.pair_id
    RETURNING pair.event_id,replacement_rows.old_participant_id,replacement_rows.participant_id
  )
  UPDATE public.tournament_participants old_participant
  SET status='replaced',replaced_by=changed.participant_id,updated_at=now()
  FROM changed WHERE old_participant.id=changed.old_participant_id;

  UPDATE public.tournament_match_players match_player
  SET participant_id=CASE WHEN p_side=1 THEN pair.player_one_id ELSE pair.player_two_id END
  FROM public.tournament_matches match
  JOIN public.tournament_pairs pair ON pair.event_id=match.event_id
  JOIN public.events event ON event.id=pair.event_id AND event.social_doubles_ladder_id=v_league_id AND event.starts_at>=v_event_start
  WHERE match_player.match_id=match.id AND match.status NOT IN ('completed','cancelled')
    AND pair.league_team_id=v_team_id AND pair.status='active'
    AND match_player.side=CASE WHEN match.pair_one_id=pair.id THEN 1 ELSE 2 END
    AND (match.pair_one_id=pair.id OR match.pair_two_id=pair.id)
    AND match_player.participant_id IN (
      SELECT old_member.id FROM public.tournament_participants old_member
      WHERE old_member.event_id=pair.event_id AND old_member.user_id=v_old_user
    );
END; $$;

REVOKE ALL ON FUNCTION public.replace_league_team_member(uuid,uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_league_team_member(uuid,uuid,integer,uuid) TO authenticated;

COMMIT;
