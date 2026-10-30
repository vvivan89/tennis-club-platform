-- Tournament configuration, roster, team, draw, match, scoring and audit data.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_gender_check CHECK (gender IN ('male','female','other','prefer_not_to_say'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS tournament_format text CHECK (tournament_format IN ('doubles','team')),
  ADD COLUMN IF NOT EXISTS tournament_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tournament_rules_html text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS allow_non_member_registration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tournament_details_public boolean NOT NULL DEFAULT true;

UPDATE public.events SET tournament_format='doubles' WHERE event_type='tournament' AND tournament_format IS NULL;

CREATE OR REPLACE FUNCTION public.event_tournament_member_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, email text, gender text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_event_manager() OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())) THEN
   RAISE EXCEPTION 'Tournament manager access required';
 END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.email,p.gender FROM public.profiles p ORDER BY p.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_member_directory(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.tournament_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  logo_url text,
  color text NOT NULL DEFAULT '' CHECK (length(color) <= 80),
  group_number integer CHECK (group_number IS NULL OR group_number > 0),
  captain_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, name),
  UNIQUE(event_id, id)
);

CREATE TABLE IF NOT EXISTS public.tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'team' CHECK (category IN ('mixed','men','women','team')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('not_required','pending','paid','refunded','failed')),
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  email text,
  phone text,
  gender text CHECK (gender IN ('male','female','other','prefer_not_to_say')),
  gender_override text CHECK (gender_override IN ('male','female','other','prefer_not_to_say')),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','withdrawn','replaced')),
  replaced_by uuid REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_participants_event_idx ON public.tournament_participants(event_id, status);
CREATE INDEX IF NOT EXISTS tournament_participants_team_idx ON public.tournament_participants(team_id);
-- A member may have separate registrations in mixed and their gender category.
CREATE INDEX IF NOT EXISTS tournament_participants_member_event_idx ON public.tournament_participants(event_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tournament_participants_member_category_idx ON public.tournament_participants(event_id,user_id,category) WHERE user_id IS NOT NULL AND status='registered';

CREATE TABLE IF NOT EXISTS public.tournament_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('mixed','men','women')),
  player_one_id uuid NOT NULL REFERENCES public.tournament_participants(id) ON DELETE RESTRICT,
  player_two_id uuid NOT NULL REFERENCES public.tournament_participants(id) ON DELETE RESTRICT,
  group_number integer CHECK (group_number IS NULL OR group_number > 0),
  seed integer CHECK (seed IS NULL OR seed > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (player_one_id <> player_two_id),
  UNIQUE(event_id, id),
  UNIQUE(event_id, category, player_one_id, player_two_id)
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'team' CHECK (category IN ('mixed','men','women','team')),
  phase text NOT NULL CHECK (phase IN ('preliminary_knockout','round_robin','final_knockout','team_round_robin','team_knockout')),
  group_number integer CHECK (group_number IS NULL OR group_number > 0),
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  match_number integer NOT NULL DEFAULT 1 CHECK (match_number > 0),
  pair_one_id uuid REFERENCES public.tournament_pairs(id) ON DELETE SET NULL,
  pair_two_id uuid REFERENCES public.tournament_pairs(id) ON DELETE SET NULL,
  team_one_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  team_two_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  court_number integer CHECK (court_number IS NULL OR court_number BETWEEN 1 AND 4),
  score_sets jsonb NOT NULL DEFAULT '[]'::jsonb,
  winner_side smallint CHECK (winner_side IN (1,2)),
  team_points_one integer NOT NULL DEFAULT 0 CHECK (team_points_one >= 0),
  team_points_two integer NOT NULL DEFAULT 0 CHECK (team_points_two >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled','bye')),
  notes text NOT NULL DEFAULT '',
  entered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pair_one_id IS NULL OR pair_two_id IS NULL OR pair_one_id <> pair_two_id),
  CHECK (team_one_id IS NULL OR team_two_id IS NULL OR team_one_id <> team_two_id)
);
CREATE INDEX IF NOT EXISTS tournament_matches_schedule_idx ON public.tournament_matches(event_id, scheduled_at, court_number);
CREATE INDEX IF NOT EXISTS tournament_matches_phase_idx ON public.tournament_matches(event_id, category, phase, group_number, round_number, match_number);

CREATE TABLE IF NOT EXISTS public.tournament_match_players (
  match_id uuid NOT NULL REFERENCES public.tournament_matches(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.tournament_participants(id) ON DELETE RESTRICT,
  side smallint NOT NULL CHECK (side IN (1,2)),
  team_id uuid REFERENCES public.tournament_teams(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id, participant_id)
);

CREATE TABLE IF NOT EXISTS public.tournament_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_audit_event_idx ON public.tournament_audit_log(event_id, created_at DESC);

-- Public views deliberately expose names and competition data only, never private contact/payment fields.
CREATE OR REPLACE VIEW public.tournament_public_teams AS
SELECT t.id, t.event_id, t.name, t.logo_url, t.color, t.group_number, t.captain_user_id, p.full_name AS captain_name
FROM public.tournament_teams t
LEFT JOIN public.profiles p ON p.id=t.captain_user_id
JOIN public.events e ON e.id=t.event_id
WHERE e.status='published' AND e.tournament_details_public=true;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name, p.gender, p.status
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND e.tournament_details_public=true AND p.status='registered';

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id
JOIN public.tournament_participants b ON b.id=p.player_two_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND e.tournament_details_public=true;

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id, m.event_id, m.category, m.phase, m.group_number, m.round_number, m.match_number,
       m.pair_one_id, m.pair_two_id, m.team_one_id, m.team_two_id, m.scheduled_at, m.court_number,
       m.score_sets, m.winner_side, m.team_points_one, m.team_points_two, m.status, m.notes,
       p1.name AS team_one_name, p2.name AS team_two_name,
       coalesce(side_one.players, a.player_one_name || ' + ' || a.player_two_name) AS player_one_name,
       NULL::text AS player_two_name,
       coalesce(side_two.players, b.player_one_name || ' + ' || b.player_two_name) AS opponent_one_name,
       NULL::text AS opponent_two_name
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.status='published' AND e.tournament_details_public=true
LEFT JOIN public.tournament_teams p1 ON p1.id=m.team_one_id
LEFT JOIN public.tournament_teams p2 ON p2.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs a ON a.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs b ON b.id=m.pair_two_id
LEFT JOIN LATERAL (
 SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=1
) side_one ON true
LEFT JOIN LATERAL (
 SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=2
) side_two ON true;

CREATE OR REPLACE VIEW public.tournament_ranked_sets AS
SELECT m.id::text || ':' || set_data.set_no::text AS id,
       m.event_id, CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at <= now() THEN m.scheduled_at ELSE m.updated_at END AS played_at,
       (side_one.users)[1] AS player_one_user_id, (side_one.users)[2] AS player_two_user_id,
       (side_two.users)[1] AS player_three_user_id, (side_two.users)[2] AS player_four_user_id,
       (set_data.set_score->>'one')::integer AS player_one_score,
       (set_data.set_score->>'two')::integer AS player_two_score
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.event_type='tournament'
CROSS JOIN LATERAL jsonb_array_elements(m.score_sets) WITH ORDINALITY AS set_data(set_score,set_no)
LEFT JOIN LATERAL (
 SELECT array_agg(p.user_id ORDER BY p.display_name) FILTER (WHERE p.user_id IS NOT NULL) AS users
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=1
) side_one ON true
LEFT JOIN LATERAL (
 SELECT array_agg(p.user_id ORDER BY p.display_name) FILTER (WHERE p.user_id IS NOT NULL) AS users
 FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id
 WHERE mp.match_id=m.id AND mp.side=2
) side_two ON true
WHERE m.status='completed' AND jsonb_typeof(m.score_sets)='array';
REVOKE ALL ON public.tournament_ranked_sets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_ranked_sets TO service_role;

ALTER TABLE public.tournament_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tournament managers manage teams" ON public.tournament_teams;
CREATE POLICY "Tournament managers manage teams" ON public.tournament_teams FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers manage participants" ON public.tournament_participants;
CREATE POLICY "Tournament managers manage participants" ON public.tournament_participants FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers manage pairs" ON public.tournament_pairs;
CREATE POLICY "Tournament managers manage pairs" ON public.tournament_pairs FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers manage matches" ON public.tournament_matches;
CREATE POLICY "Tournament managers manage matches" ON public.tournament_matches FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Captains edit their team matches" ON public.tournament_matches;
CREATE POLICY "Captains edit their team matches" ON public.tournament_matches FOR UPDATE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.tournament_teams t JOIN public.profiles p ON p.id=t.captain_user_id WHERE p.id=auth.uid() AND (t.id=team_one_id OR t.id=team_two_id) AND t.event_id=tournament_matches.event_id))
 WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_teams t JOIN public.profiles p ON p.id=t.captain_user_id WHERE p.id=auth.uid() AND (t.id=team_one_id OR t.id=team_two_id) AND t.event_id=tournament_matches.event_id));
DROP POLICY IF EXISTS "Tournament managers manage match players" ON public.tournament_match_players;
CREATE POLICY "Tournament managers manage match players" ON public.tournament_match_players FOR ALL TO authenticated
 USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())))
 WITH CHECK (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Members read own tournament participant row" ON public.tournament_participants;
CREATE POLICY "Members read own tournament participant row" ON public.tournament_participants FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "Public read published tournament match players" ON public.tournament_match_players;
CREATE POLICY "Public read published tournament match players" ON public.tournament_match_players FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND e.status='published' AND e.tournament_details_public=true));
DROP POLICY IF EXISTS "Captains manage their match pairings" ON public.tournament_match_players;
CREATE POLICY "Captains manage their match pairings" ON public.tournament_match_players FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.tournament_teams t ON t.id=tournament_match_players.team_id WHERE m.id=match_id AND t.captain_user_id=auth.uid() AND t.event_id=m.event_id AND t.id=CASE WHEN side=1 THEN m.team_one_id ELSE m.team_two_id END AND m.status NOT IN ('completed','cancelled')))
 WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.tournament_teams t ON t.id=tournament_match_players.team_id JOIN public.tournament_participants p ON p.id=participant_id WHERE m.id=match_id AND t.captain_user_id=auth.uid() AND t.event_id=m.event_id AND t.id=CASE WHEN side=1 THEN m.team_one_id ELSE m.team_two_id END AND p.team_id=t.id AND m.status NOT IN ('completed','cancelled')));
DROP POLICY IF EXISTS "Tournament managers read audit log" ON public.tournament_audit_log;
CREATE POLICY "Tournament managers read audit log" ON public.tournament_audit_log FOR SELECT TO authenticated USING (public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));
DROP POLICY IF EXISTS "Tournament managers write audit log" ON public.tournament_audit_log;
CREATE POLICY "Tournament managers write audit log" ON public.tournament_audit_log FOR INSERT TO authenticated WITH CHECK (actor_user_id=auth.uid() AND public.is_event_manager() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_teams, public.tournament_participants, public.tournament_pairs, public.tournament_matches, public.tournament_match_players TO authenticated;
GRANT SELECT ON public.tournament_public_teams, public.tournament_public_participants, public.tournament_public_pairs, public.tournament_public_matches TO anon, authenticated;
GRANT SELECT, INSERT ON public.tournament_audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid, p_category text, p_display_name text DEFAULT NULL, p_email text DEFAULT NULL,
 p_phone text DEFAULT NULL, p_gender text DEFAULT NULL, p_partner_participant_id uuid DEFAULT NULL,
 p_partner_name text DEFAULT NULL, p_partner_email text DEFAULT NULL, p_partner_phone text DEFAULT NULL,
 p_partner_gender text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_user uuid := auth.uid(); v_event public.events%rowtype; v_profile public.profiles%rowtype;
 v_config jsonb; v_mode text; v_gender text; v_partner_gender text; v_participant_id uuid; v_partner_id uuid;
 v_pair_id uuid; v_amount integer; v_count integer;
BEGIN
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
 IF NOT FOUND OR v_event.event_type<>'tournament' OR v_event.status<>'published' THEN RAISE EXCEPTION 'Tournament registration is unavailable'; END IF;
 IF now()<v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at) OR now()>=v_event.starts_at THEN
   RAISE EXCEPTION 'Tournament registration is closed';
 END IF;
 IF p_category NOT IN ('mixed','men','women','team') THEN RAISE EXCEPTION 'Invalid tournament category'; END IF;
 v_config := coalesce(v_event.tournament_config,'{}'::jsonb);
 v_mode := coalesce(v_config->>'registration_mode','both');
 IF v_event.tournament_format='team' THEN
   IF p_category<>'team' THEN RAISE EXCEPTION 'Team tournaments register participants for team assignment'; END IF;
 ELSE
   IF p_category='team' OR NOT (coalesce(v_config->'categories','["mixed","men","women"]'::jsonb) ? p_category) THEN RAISE EXCEPTION 'This doubles category is not enabled'; END IF;
 END IF;
 IF p_partner_participant_id IS NOT NULL OR nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF v_event.tournament_format<>'doubles' OR v_mode='single' THEN RAISE EXCEPTION 'This tournament accepts individual registration only'; END IF;
 ELSIF v_event.tournament_format='doubles' AND v_mode='doubles' THEN
   RAISE EXCEPTION 'Register with a partner for this tournament';
 END IF;
 IF v_user IS NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Sign in to register for this tournament'; END IF;
   IF nullif(btrim(p_display_name),'') IS NULL OR nullif(btrim(p_email),'') IS NULL THEN RAISE EXCEPTION 'Name and email are required for non-member registration'; END IF;
   IF length(btrim(p_display_name))>160 OR length(btrim(p_email))>254 THEN RAISE EXCEPTION 'Participant details are too long'; END IF;
   v_gender := p_gender;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'This email is already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='women' AND status='registered')) OR (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_email)) AND category='men' AND status='registered')) THEN RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles'; END IF;
 ELSE
   SELECT * INTO v_profile FROM public.profiles WHERE id=v_user;
   IF NOT FOUND OR v_profile.application_status<>'approved' THEN RAISE EXCEPTION 'An approved member profile is required'; END IF;
   v_gender := v_profile.gender;
   SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND status='registered';
   IF v_event.tournament_format='team' AND v_count>=1 THEN RAISE EXCEPTION 'You are already registered for this team tournament'; END IF;
   IF v_event.tournament_format='doubles' AND v_count>=2 THEN RAISE EXCEPTION 'A player may enter no more than two doubles categories'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'You are already registered in this category'; END IF;
   IF (p_category='men' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='women' AND status='registered')) OR
      (p_category='women' AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category='men' AND status='registered')) THEN
     RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles';
   END IF;
 END IF;
 IF p_category='men' AND v_gender='female' THEN RAISE EXCEPTION 'The profile gender is not eligible for men''s doubles'; END IF;
 IF p_category='women' AND v_gender='male' THEN RAISE EXCEPTION 'The profile gender is not eligible for women''s doubles'; END IF;
 IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender value'; END IF;
 v_amount := v_event.price_cents;
 INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
 VALUES(p_event_id,v_user,p_category,CASE WHEN v_user IS NOT NULL THEN coalesce(nullif(v_profile.full_name,''),v_profile.email) ELSE btrim(p_display_name) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.email ELSE lower(btrim(p_email)) END,
        CASE WHEN v_user IS NOT NULL THEN v_profile.phone ELSE nullif(btrim(p_phone),'') END,
        v_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
 RETURNING id INTO v_participant_id;
 IF p_partner_participant_id IS NOT NULL THEN
   SELECT coalesce(gender_override,gender) INTO v_partner_gender FROM public.tournament_participants
   WHERE id=p_partner_participant_id AND event_id=p_event_id AND category=p_category AND status='registered';
   IF NOT FOUND THEN RAISE EXCEPTION 'The selected partner is not registered in this category'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_pairs WHERE event_id=p_event_id AND category=p_category AND (player_one_id=p_partner_participant_id OR player_two_id=p_partner_participant_id)) THEN RAISE EXCEPTION 'The selected partner is already paired in this category'; END IF;
   v_partner_id := p_partner_participant_id;
 ELSIF nullif(btrim(p_partner_name),'') IS NOT NULL THEN
   IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'Register the partner as a member first, or ask the organizer to enable non-member registration'; END IF;
   IF nullif(btrim(p_partner_email),'') IS NULL THEN RAISE EXCEPTION 'Partner email is required'; END IF;
   IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender value'; END IF;
   IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND lower(email)=lower(btrim(p_partner_email)) AND category=p_category AND status='registered') THEN RAISE EXCEPTION 'Partner email is already registered in this category'; END IF;
   IF p_category='men' AND p_partner_gender='female' THEN RAISE EXCEPTION 'The partner profile gender is not eligible for men''s doubles'; END IF;
   IF p_category='women' AND p_partner_gender='male' THEN RAISE EXCEPTION 'The partner profile gender is not eligible for women''s doubles'; END IF;
   IF p_category='mixed' AND v_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_gender=p_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
   INSERT INTO public.tournament_participants(event_id,category,display_name,email,phone,gender,amount_cents,payment_status)
   VALUES(p_event_id,p_category,btrim(p_partner_name),lower(btrim(p_partner_email)),nullif(btrim(p_partner_phone),''),p_partner_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
   RETURNING id INTO v_partner_id;
 ELSE
   v_partner_id := NULL;
 END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_gender IN ('male','female') AND v_partner_gender IN ('male','female') AND v_gender=v_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='men' AND v_partner_gender='female' THEN RAISE EXCEPTION 'The selected partner is not eligible for men''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='women' AND v_partner_gender='male' THEN RAISE EXCEPTION 'The selected partner is not eligible for women''s doubles'; END IF;
 IF v_partner_id IS NOT NULL THEN
   INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
   VALUES(p_event_id,p_category,v_participant_id,v_partner_id) RETURNING id INTO v_pair_id;
 END IF;
 RETURN jsonb_build_object('participantId',v_participant_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END);
END;
$$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO anon, authenticated;

-- Individual event scores remain unavailable for all tournament events, including direct API calls.
DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated WITH CHECK (
 entered_by=auth.uid() AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.event_type<>'tournament')
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=auth.uid() AND r.status='confirmed' AND r.event_id=event_scores.event_id)
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')
 AND (player_three_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_three_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
 AND (player_four_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_four_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
);

-- Score and schedule edits are audited, including manager corrections after a match is played.
CREATE OR REPLACE FUNCTION public.audit_tournament_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_id uuid; v_actor uuid := auth.uid(); v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
 v_event_id := CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
 v_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP<>'INSERT' THEN v_before := to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN v_after := to_jsonb(NEW); END IF;
 INSERT INTO public.tournament_audit_log(event_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(v_event_id,v_actor,lower(TG_OP),TG_TABLE_NAME,v_id,v_before,v_after);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_tournament_matches ON public.tournament_matches;
CREATE TRIGGER audit_tournament_matches AFTER INSERT OR UPDATE OR DELETE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();
DROP TRIGGER IF EXISTS audit_tournament_teams ON public.tournament_teams;
CREATE TRIGGER audit_tournament_teams AFTER INSERT OR UPDATE OR DELETE ON public.tournament_teams FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();
DROP TRIGGER IF EXISTS audit_tournament_participants ON public.tournament_participants;
CREATE TRIGGER audit_tournament_participants AFTER INSERT OR UPDATE OR DELETE ON public.tournament_participants FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();
DROP TRIGGER IF EXISTS audit_tournament_pairs ON public.tournament_pairs;
CREATE TRIGGER audit_tournament_pairs AFTER INSERT OR UPDATE OR DELETE ON public.tournament_pairs FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_change();

CREATE OR REPLACE FUNCTION public.guard_captain_tournament_score_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_is_captain boolean;
BEGIN
 SELECT EXISTS (SELECT 1 FROM public.tournament_teams t WHERE t.event_id=OLD.event_id AND t.captain_user_id=auth.uid() AND (t.id=OLD.team_one_id OR t.id=OLD.team_two_id)) INTO v_is_captain;
 IF v_is_captain AND NOT public.is_event_manager() THEN
   IF (to_jsonb(NEW) - ARRAY['score_sets','winner_side','team_points_one','team_points_two','status','entered_by','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['score_sets','winner_side','team_points_one','team_points_two','status','entered_by','updated_at']) THEN
     RAISE EXCEPTION 'Team captains may edit match results only';
   END IF;
   NEW.entered_by := auth.uid();
   NEW.updated_at := now();
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_captain_tournament_score_edit ON public.tournament_matches;
CREATE TRIGGER guard_captain_tournament_score_edit BEFORE UPDATE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION public.guard_captain_tournament_score_edit();
