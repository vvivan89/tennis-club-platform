-- Public tournament views expose only the effective tournament gender used for eligibility.
-- Contact and payment fields remain excluded from this view.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name,
       coalesce(p.gender_override, p.gender) AS gender, p.status
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND p.status='registered'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own
    WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));
