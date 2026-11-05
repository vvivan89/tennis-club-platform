CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id,
    p.event_id,
    p.category,
    p.player_one_id,
    p.player_two_id,
    p.group_number,
    p.seed,
    p.status,
    a.display_name AS player_one_name,
    b.display_name AS player_two_name,
    COALESCE(a.tennis_skill_level::text, profile_a.tennis_skill_level) AS player_one_skill_level,
    COALESCE(b.tennis_skill_level::text, profile_b.tennis_skill_level) AS player_two_skill_level
   FROM tournament_pairs p
     JOIN tournament_participants a ON a.id = p.player_one_id AND a.status = 'registered'::text AND a.confirmation_status = 'confirmed'::text
     JOIN tournament_participants b ON b.id = p.player_two_id AND b.status = 'registered'::text AND b.confirmation_status = 'confirmed'::text
     LEFT JOIN profiles profile_a ON profile_a.id = a.user_id
     LEFT JOIN profiles profile_b ON profile_b.id = b.user_id
     JOIN events e ON e.id = p.event_id
  WHERE e.status = 'published'::event_status AND (a.user_id IS NULL OR profile_a.application_status = 'approved'::text AND profile_a.account_kind = 'member'::text OR profile_a.account_kind = 'event_guest'::text) AND (b.user_id IS NULL OR profile_b.application_status = 'approved'::text AND profile_b.account_kind = 'member'::text OR profile_b.account_kind = 'event_guest'::text) AND (e.tournament_details_public = true OR (EXISTS ( SELECT 1
           FROM profiles viewer
          WHERE viewer.id = auth.uid() AND viewer.application_status = 'approved'::text AND viewer.account_kind = 'member'::text)) OR auth.uid() IS NOT NULL AND (EXISTS ( SELECT 1
           FROM tournament_participants own
          WHERE own.event_id = e.id AND own.user_id = auth.uid() AND own.status = 'registered'::text)));;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM service_role;
GRANT CREATE, USAGE ON SCHEMA public TO service_role;
