-- Captain request status is private to the participant and event managers.
-- The public participant view keeps a constant false in its additive column.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  (p.user_id IS NOT NULL) AS is_member,false AS captain_requested
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

DROP FUNCTION public.event_tournament_my_entries(uuid);
CREATE FUNCTION public.event_tournament_my_entries(p_event_id uuid)
RETURNS TABLE(id uuid,team_id uuid,category text,display_name text,email text,phone text,gender text,tennis_skill_level numeric,
  payment_status text,amount_cents integer,confirmation_status text,partner_id uuid,partner_name text,partner_email text,
  partner_phone text,partner_gender text,partner_skill_level numeric,partner_confirmation_status text,
  partner_is_league_team boolean,captain_requested boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT own.id,own.team_id,own.category,own.display_name,own.email,own.phone,
    coalesce(own.gender_override,own.gender),own.tennis_skill_level,
    own.payment_status,own.amount_cents,own.confirmation_status,partner.id,partner.display_name,partner.email,partner.phone,
    coalesce(partner.gender_override,partner.gender),partner.tennis_skill_level,partner.confirmation_status,
    (pair.league_team_id IS NOT NULL),own.captain_requested
  FROM public.tournament_participants own
  LEFT JOIN public.tournament_pairs pair ON pair.event_id=own.event_id AND pair.status='active'
    AND own.id IN (pair.player_one_id,pair.player_two_id)
  LEFT JOIN public.tournament_participants partner ON partner.id=CASE WHEN pair.player_one_id=own.id THEN pair.player_two_id ELSE pair.player_one_id END
  WHERE own.event_id=p_event_id AND own.user_id=auth.uid() AND own.status IN ('registered','provisional')
  ORDER BY own.created_at,own.category;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_my_entries(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_my_entries(uuid) TO authenticated;
