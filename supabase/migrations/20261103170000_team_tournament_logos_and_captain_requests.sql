ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS captain_requested boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.request_tournament_captain(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Please sign in to request team captain status';
  END IF;

  UPDATE public.tournament_participants participant
  SET captain_requested = true, updated_at = now()
  FROM public.events event, public.profiles profile
  WHERE participant.id = p_participant_id
    AND participant.event_id = event.id
    AND participant.user_id = auth.uid()
    AND participant.status = 'registered'
    AND participant.confirmation_status = 'confirmed'
    AND event.event_type = 'tournament'
    AND event.tournament_format = 'team'
    AND profile.id = auth.uid()
    AND profile.application_status = 'approved'
    AND profile.account_kind = 'member';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A confirmed team tournament registration is required to request captain status';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.request_tournament_captain(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_tournament_captain(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  (p.user_id IS NOT NULL) AS is_member,p.captain_requested
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

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('tournament-team-logos','tournament-team-logos',true,3145728,
  ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read tournament team logos" ON storage.objects
  FOR SELECT TO anon,authenticated USING (bucket_id='tournament-team-logos');
CREATE POLICY "Event managers upload tournament team logos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='tournament-team-logos' AND public.is_event_manager()
    AND EXISTS (SELECT 1 FROM public.events event
      WHERE event.id::text=(storage.foldername(name))[1]
        AND (public.is_admin() OR event.organizer_id=auth.uid() OR event.created_by=auth.uid()))
  );
CREATE POLICY "Event managers update tournament team logos" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id='tournament-team-logos' AND public.is_event_manager()
    AND EXISTS (SELECT 1 FROM public.events event
      WHERE event.id::text=(storage.foldername(name))[1]
        AND (public.is_admin() OR event.organizer_id=auth.uid() OR event.created_by=auth.uid()))
  ) WITH CHECK (
    bucket_id='tournament-team-logos' AND public.is_event_manager()
    AND EXISTS (SELECT 1 FROM public.events event
      WHERE event.id::text=(storage.foldername(name))[1]
        AND (public.is_admin() OR event.organizer_id=auth.uid() OR event.created_by=auth.uid()))
  );
CREATE POLICY "Event managers delete tournament team logos" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='tournament-team-logos' AND public.is_event_manager()
    AND EXISTS (SELECT 1 FROM public.events event
      WHERE event.id::text=(storage.foldername(name))[1]
        AND (public.is_admin() OR event.organizer_id=auth.uid() OR event.created_by=auth.uid()))
  );
