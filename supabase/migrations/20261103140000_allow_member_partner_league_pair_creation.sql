-- The tournament registration RPC creates a selected member's participant row
-- before attaching the member profile ID. Permit that transactional intermediate
-- state in League pair validation; the invite remains pending until confirmation.
CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_league uuid; v_gender text; v_allow_guest boolean; v_one uuid; v_two uuid;
  v_one_status text; v_two_status text; v_one_confirm text; v_two_confirm text; v_one_email text; v_two_email text;
  v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender,e.allow_non_member_registration
    INTO v_league,v_gender,v_allow_guest
  FROM public.events e JOIN public.social_doubles_ladders l
    ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id,p1.status,p2.status,p1.confirmation_status,p2.confirmation_status,p1.email,p2.email
    INTO v_one,v_two,v_one_status,v_two_status,v_one_confirm,v_two_confirm,v_one_email,v_two_email
    FROM public.tournament_participants p1,public.tournament_participants p2
    WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF (v_one IS NULL AND NOT (
        (v_allow_guest AND v_one_status='provisional' AND v_one_confirm='pending' AND v_one_email IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.application_status='approved'
          AND p.account_kind='member' AND lower(p.email)=lower(v_one_email))
      ))
    OR (v_two IS NULL AND NOT (
        (v_allow_guest AND v_two_status='provisional' AND v_two_confirm='pending' AND v_two_email IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.application_status='approved'
          AND p.account_kind='member' AND lower(p.email)=lower(v_two_email))
      )) THEN
    RAISE EXCEPTION 'League teams require two verified players or an invited event-only partner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two)
      AND NOT (p.application_status='approved' AND p.account_kind='member')
      AND NOT (v_allow_guest AND p.account_kind IN ('event_guest','member'))
  ) THEN RAISE EXCEPTION 'League participants must be approved members or verified event-only registrants'; END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two)
      OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fix_confirmed_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_pair public.tournament_pairs%rowtype;
  v_one public.tournament_participants%rowtype;
  v_two public.tournament_participants%rowtype;
  v_existing_one public.league_teams%rowtype;
  v_existing_two public.league_teams%rowtype;
  v_team_id uuid;
  v_event_id uuid;
  v_participant_id uuid;
BEGIN
  IF TG_TABLE_NAME='tournament_participants' THEN
    IF NEW.user_id IS NULL OR NEW.status<>'registered' OR NEW.confirmation_status<>'confirmed' THEN RETURN NEW; END IF;
    -- register_tournament_entry briefly links the selected member before its
    -- wrapper marks that invite pending. Do not establish the team at that step.
    IF TG_OP='UPDATE' AND OLD.user_id IS NULL AND NEW.user_id IS NOT NULL
       AND OLD.confirmation_status='confirmed' THEN RETURN NEW; END IF;
    v_event_id:=NEW.event_id;
    v_participant_id:=NEW.id;
  ELSE
    IF NEW.status<>'active' OR NEW.league_team_id IS NOT NULL THEN RETURN NEW; END IF;
    v_event_id:=NEW.event_id;
    v_participant_id:=NEW.player_one_id;
  END IF;
  SELECT e.* INTO v_event FROM public.events e
    WHERE e.id=v_event_id AND e.event_type='tournament' AND e.social_doubles_ladder_id IS NOT NULL;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.social_doubles_ladders l
      WHERE l.id=v_event.social_doubles_ladder_id AND l.competition_type='league') THEN RETURN NEW; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs p WHERE p.event_id=v_event_id AND p.status='active'
    AND v_participant_id IN (p.player_one_id,p.player_two_id) FOR UPDATE;
  IF NOT FOUND OR v_pair.league_team_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_one FROM public.tournament_participants WHERE id=v_pair.player_one_id FOR UPDATE;
  SELECT * INTO v_two FROM public.tournament_participants WHERE id=v_pair.player_two_id FOR UPDATE;
  IF v_one.user_id IS NULL OR v_two.user_id IS NULL
     OR v_one.status<>'registered' OR v_two.status<>'registered'
     OR v_one.confirmation_status<>'confirmed' OR v_two.confirmation_status<>'confirmed' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_one.user_id,v_two.user_id)
      AND NOT (p.account_kind='member' AND p.application_status='approved')
      AND NOT (v_event.allow_non_member_registration AND p.account_kind='event_guest')) THEN
    RAISE EXCEPTION 'League pair must contain approved members or confirmed event-only registrants';
  END IF;
  SELECT * INTO v_existing_one FROM public.league_teams t WHERE t.league_id=v_event.social_doubles_ladder_id
    AND t.status='active' AND v_one.user_id IN (t.player_one_id,t.player_two_id) FOR UPDATE;
  SELECT * INTO v_existing_two FROM public.league_teams t WHERE t.league_id=v_event.social_doubles_ladder_id
    AND t.status='active' AND v_two.user_id IN (t.player_one_id,t.player_two_id) FOR UPDATE;
  IF v_existing_one.id IS NOT NULL AND v_existing_two.id IS NOT NULL
     AND v_existing_one.id IS DISTINCT FROM v_existing_two.id THEN
    RAISE EXCEPTION 'League partners are fixed after team confirmation';
  END IF;
  IF v_existing_one.id IS NOT NULL OR v_existing_two.id IS NOT NULL THEN
    v_team_id:=coalesce(v_existing_one.id,v_existing_two.id);
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=v_team_id
      AND ((t.player_one_id=v_one.user_id AND t.player_two_id=v_two.user_id)
        OR (t.player_one_id=v_two.user_id AND t.player_two_id=v_one.user_id))) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
  ELSE
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id,status,confirmed_at)
    VALUES(v_event.social_doubles_ladder_id,v_one.user_id,v_two.user_id,'active',now())
    RETURNING id INTO v_team_id;
  END IF;
  UPDATE public.tournament_pairs SET league_team_id=v_team_id WHERE id=v_pair.id;
  RETURN NEW;
END; $$;
