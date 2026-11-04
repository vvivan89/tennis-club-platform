CREATE OR REPLACE FUNCTION public.admin_create_tournament_team(
  p_event_id uuid,
  p_name text,
  p_color text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_captain_user_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_id uuid;
  v_captain_participant_id uuid;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events event
    WHERE event.id=p_event_id
      AND event.event_type='tournament'
      AND event.tournament_format='team'
      AND (public.is_admin() OR event.organizer_id=auth.uid() OR event.created_by=auth.uid())
  ) THEN
    RAISE EXCEPTION 'You are not allowed to manage this team tournament';
  END IF;
  IF nullif(btrim(p_name),'') IS NULL THEN
    RAISE EXCEPTION 'Team name is required';
  END IF;

  IF p_captain_user_id IS NOT NULL THEN
    SELECT participant.id INTO v_captain_participant_id
    FROM public.tournament_participants participant
    WHERE participant.event_id=p_event_id
      AND participant.user_id=p_captain_user_id
      AND participant.category='team'
      AND participant.status='registered'
    ORDER BY participant.created_at
    LIMIT 1;
    IF v_captain_participant_id IS NULL THEN
      RAISE EXCEPTION 'The selected captain must be a registered team tournament player';
    END IF;
  END IF;

  INSERT INTO public.tournament_teams(event_id,name,color,logo_url,captain_user_id)
  VALUES (p_event_id,btrim(p_name),nullif(btrim(p_color),''),p_logo_url,p_captain_user_id)
  RETURNING id INTO v_team_id;

  IF v_captain_participant_id IS NOT NULL THEN
    UPDATE public.tournament_teams
    SET captain_user_id=NULL
    WHERE event_id=p_event_id AND captain_user_id=p_captain_user_id AND id<>v_team_id;
    UPDATE public.tournament_participants
    SET team_id=v_team_id,updated_at=now()
    WHERE id=v_captain_participant_id;
  END IF;
  RETURN v_team_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_tournament_team(uuid,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_create_tournament_team(uuid,text,text,text,uuid) TO authenticated;
