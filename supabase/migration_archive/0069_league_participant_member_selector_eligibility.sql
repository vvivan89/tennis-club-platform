-- Return eligibility for every member in the admin participant selector, not only current entrants.
BEGIN;

DROP FUNCTION IF EXISTS public.league_event_pair_eligibility(uuid);
CREATE FUNCTION public.league_event_pair_eligibility(p_event_id uuid)
RETURNS TABLE(user_id uuid,eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND l.competition_type='league'
      AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  RETURN QUERY
  SELECT profile.id,
    (profile.application_status='approved' AND public.has_active_paid_membership(profile.id))
  FROM public.profiles profile;
END; $$;

REVOKE ALL ON FUNCTION public.league_event_pair_eligibility(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.league_event_pair_eligibility(uuid) TO authenticated;

COMMIT;
