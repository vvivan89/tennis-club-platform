-- Add individual-entry singles tournaments alongside the existing doubles/team formats.
ALTER TABLE public.tournament_participants DROP CONSTRAINT IF EXISTS tournament_participants_category_check;
ALTER TABLE public.tournament_participants ADD CONSTRAINT tournament_participants_category_check
  CHECK (category IN ('all','mixed','men','women','team'));
ALTER TABLE public.tournament_matches DROP CONSTRAINT IF EXISTS tournament_matches_category_check;
ALTER TABLE public.tournament_matches ADD CONSTRAINT tournament_matches_category_check
  CHECK (category IN ('all','mixed','men','women','team'));
ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS group_number integer CHECK (group_number IS NULL OR group_number > 0),
  ADD COLUMN IF NOT EXISTS seed integer CHECK (seed IS NULL OR seed > 0);
ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS player_one_participant_id uuid REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS player_two_participant_id uuid REFERENCES public.tournament_participants(id) ON DELETE SET NULL;
ALTER TABLE public.tournament_matches DROP CONSTRAINT IF EXISTS tournament_matches_distinct_singles_players_check;
ALTER TABLE public.tournament_matches ADD CONSTRAINT tournament_matches_distinct_singles_players_check
  CHECK (player_one_participant_id IS NULL OR player_two_participant_id IS NULL OR player_one_participant_id <> player_two_participant_id);
ALTER TABLE public.tournament_matches DROP CONSTRAINT IF EXISTS tournament_matches_single_entry_sides_check;
ALTER TABLE public.tournament_matches ADD CONSTRAINT tournament_matches_single_entry_sides_check CHECK (
  (player_one_participant_id IS NULL AND player_two_participant_id IS NULL)
  OR (pair_one_id IS NULL AND pair_two_id IS NULL AND team_one_id IS NULL AND team_two_id IS NULL)
);

CREATE OR REPLACE FUNCTION public.validate_singles_tournament_match_sides()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_format text; v_config jsonb;
BEGIN
  SELECT tournament_format,tournament_config INTO v_format,v_config
  FROM public.events WHERE id=NEW.event_id AND event_type='tournament';
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_format='singles' THEN
    IF NEW.pair_one_id IS NOT NULL OR NEW.pair_two_id IS NOT NULL OR NEW.team_one_id IS NOT NULL OR NEW.team_two_id IS NOT NULL THEN
      RAISE EXCEPTION 'Singles matches must use individual player entries';
    END IF;
    IF NEW.category NOT IN ('all','men','women') OR NOT (coalesce(v_config->'categories','["all","men","women"]'::jsonb) ? NEW.category) THEN
      RAISE EXCEPTION 'This singles match category is not enabled';
    END IF;
    IF NEW.player_one_participant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tournament_participants p WHERE p.id=NEW.player_one_participant_id
        AND p.event_id=NEW.event_id AND p.category=NEW.category AND p.status='registered'
    ) THEN RAISE EXCEPTION 'Side one must be a registered singles player in this category'; END IF;
    IF NEW.player_two_participant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tournament_participants p WHERE p.id=NEW.player_two_participant_id
        AND p.event_id=NEW.event_id AND p.category=NEW.category AND p.status='registered'
    ) THEN RAISE EXCEPTION 'Side two must be a registered singles player in this category'; END IF;
  ELSIF NEW.player_one_participant_id IS NOT NULL OR NEW.player_two_participant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Individual player sides are only valid for singles tournaments';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_singles_tournament_match_sides ON public.tournament_matches;
CREATE TRIGGER validate_singles_tournament_match_sides
BEFORE INSERT OR UPDATE OF event_id,category,pair_one_id,pair_two_id,team_one_id,team_two_id,player_one_participant_id,player_two_participant_id
ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION public.validate_singles_tournament_match_sides();

CREATE OR REPLACE FUNCTION public.enforce_tournament_participant_skill_range()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_format text; v_config jsonb; v_ladder_id uuid; v_competition_type text;
  v_minimum numeric; v_maximum numeric; v_skill numeric; v_profile_skill numeric;
  v_approved_member boolean := false;
BEGIN
  SELECT event.tournament_format,event.tournament_config,event.social_doubles_ladder_id
    INTO v_format,v_config,v_ladder_id FROM public.events event
    WHERE event.id=NEW.event_id AND event.event_type='tournament';
  IF NOT FOUND OR v_format NOT IN ('doubles','singles') THEN RETURN NEW; END IF;
  IF v_ladder_id IS NOT NULL THEN
    SELECT competition_type INTO v_competition_type FROM public.social_doubles_ladders WHERE id=v_ladder_id;
  END IF;
  IF v_competition_type='league' THEN
    SELECT minimum_tennis_skill_level,maximum_tennis_skill_level INTO v_minimum,v_maximum
      FROM public.social_doubles_ladders WHERE id=v_ladder_id;
  ELSE
    v_minimum:=nullif(v_config->>'minimum_tennis_skill_level','')::numeric;
    v_maximum:=nullif(v_config->>'maximum_tennis_skill_level','')::numeric;
  END IF;
  IF v_minimum IS NULL AND v_maximum IS NULL THEN RETURN NEW; END IF;
  v_skill:=NEW.tennis_skill_level;
  IF NEW.user_id IS NOT NULL THEN
    SELECT profile.tennis_skill_level::numeric,
      profile.account_kind='member' AND profile.application_status='approved'
      INTO v_profile_skill,v_approved_member FROM public.profiles profile WHERE profile.id=NEW.user_id;
    IF v_approved_member OR v_profile_skill IS NOT NULL THEN v_skill:=v_profile_skill; END IF;
  END IF;
  IF v_skill IS NULL THEN RAISE EXCEPTION 'A tennis skill rating is required for this event''s skill restriction'; END IF;
  IF (v_minimum IS NOT NULL AND v_skill<v_minimum) OR (v_maximum IS NOT NULL AND v_skill>v_maximum) THEN
    RAISE EXCEPTION 'Tennis skill rating must be between % and % for this event',coalesce(v_minimum::text,'2.5'),coalesce(v_maximum::text,'7.0');
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.register_tournament_singles_entry(
  p_event_id uuid,p_category text,p_display_name text DEFAULT NULL,p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,p_gender text DEFAULT NULL,p_tennis_skill_level numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype; v_user uuid:=auth.uid(); v_profile public.profiles%rowtype;
  v_name text:=nullif(btrim(p_display_name),''); v_email text:=nullif(btrim(p_email),'');
  v_phone text:=nullif(btrim(p_phone),''); v_gender text:=p_gender; v_skill numeric:=p_tennis_skill_level;
  v_price jsonb; v_id uuid; v_count integer; v_capacity integer; v_paid_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to register'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament' AND tournament_format='singles';
  IF NOT FOUND THEN RAISE EXCEPTION 'Singles tournament was not found'; END IF;
  IF v_event.status<>'published' OR now()<v_event.registration_opens_at
    OR now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF p_category IS NULL OR p_category NOT IN ('all','men','women') OR NOT (coalesce(v_event.tournament_config->'categories','["all","men","women"]'::jsonb) ? p_category) THEN
    RAISE EXCEPTION 'This singles category is not enabled';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text||':'||v_user::text,0));
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complete your profile before registering'; END IF;
  IF v_profile.account_kind='member' AND v_profile.application_status='approved' THEN
    v_name:=coalesce(nullif(v_profile.full_name,''),v_profile.email);
    v_email:=v_profile.email; v_phone:=v_profile.phone; v_gender:=v_profile.gender;
    v_skill:=nullif(v_profile.tennis_skill_level,'')::numeric;
  ELSIF v_profile.account_kind='event_guest' OR (v_profile.account_kind='member' AND v_profile.application_status<>'approved') THEN
    IF NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'This event is not accepting event-only registrations'; END IF;
    v_name:=coalesce(v_name,nullif(v_profile.full_name,''));
    v_email:=coalesce(v_profile.email,v_email); v_phone:=coalesce(v_phone,nullif(v_profile.phone,''));
    v_gender:=coalesce(v_profile.gender,v_gender);
    v_skill:=coalesce(nullif(v_profile.tennis_skill_level,'')::numeric,v_skill);
  ELSE
    RAISE EXCEPTION 'This account cannot register for tournaments';
  END IF;
  IF v_name IS NULL OR v_email IS NULL THEN RAISE EXCEPTION 'Name and email are required'; END IF;
  IF v_gender IS NULL OR v_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'Gender is required for singles registration'; END IF;
  IF (p_category='men' AND v_gender='female') OR (p_category='women' AND v_gender='male') THEN
    RAISE EXCEPTION 'Your profile gender is not eligible for this category';
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user
    AND status IN ('registered','provisional') AND category=p_category) THEN RAISE EXCEPTION 'You are already registered in this category'; END IF;
  IF p_category IN ('men','women') AND EXISTS(SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id
    AND user_id=v_user AND status IN ('registered','provisional') AND category IN ('men','women') AND category<>p_category) THEN
    RAISE EXCEPTION 'You cannot enter both men''s and women''s singles';
  END IF;
  IF (SELECT count(*) FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user
    AND status IN ('registered','provisional'))>=2 THEN RAISE EXCEPTION 'A player may enter up to two singles categories'; END IF;
  SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id=p_event_id AND category=p_category AND status IN ('registered','provisional');
  v_capacity:=nullif(v_event.tournament_config->'category_capacities'->>p_category,'')::integer;
  IF v_capacity IS NOT NULL AND v_count>=v_capacity THEN RAISE EXCEPTION 'This category is full'; END IF;
  IF v_event.tournament_config->>'total_capacity' IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id=p_event_id AND status IN ('registered','provisional');
    IF v_count>=nullif(v_event.tournament_config->>'total_capacity','')::integer THEN RAISE EXCEPTION 'This tournament is full'; END IF;
  END IF;
  v_price:=public.calculate_tournament_registration_price(p_event_id,v_user,p_category,false);
  v_paid_status:=CASE WHEN (v_price->>'amountCents')::integer=0 THEN 'not_required' ELSE 'pending' END;
  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,
    amount_cents,base_amount_cents,discount_cents,pricing_details,payment_status,confirmation_status,confirmed_at)
  VALUES(p_event_id,v_user,p_category,v_name,lower(v_email),v_phone,v_gender,v_skill,
    (v_price->>'amountCents')::integer,(v_price->>'baseAmountCents')::integer,(v_price->>'discountCents')::integer,v_price,v_paid_status,'confirmed',now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('participantId',v_id,'amountCents',(v_price->>'amountCents')::integer,
    'discountCents',(v_price->>'discountCents')::integer,'pricingDetails',v_price,'paymentStatus',v_paid_status);
END; $$;
REVOKE ALL ON FUNCTION public.register_tournament_singles_entry(uuid,text,text,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_singles_entry(uuid,text,text,text,text,text,numeric) TO authenticated;

-- Admin entries use the same individual participant model and never create a pair.
CREATE OR REPLACE FUNCTION public.register_tournament_participant_admin(
  p_event_id uuid, p_user_id uuid, p_category text, p_display_name text,
  p_email text, p_phone text, p_gender text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_price jsonb;
  v_id uuid;
  v_user_id uuid := p_user_id;
  v_name text := nullif(btrim(p_display_name), '');
  v_email text := nullif(btrim(p_email), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_gender text := p_gender;
  v_league_gender text;
  v_expected_category text;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND event_type = 'tournament';
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament event was not found'; END IF;

  IF v_event.social_doubles_ladder_id IS NOT NULL THEN
    SELECT gender INTO v_league_gender FROM public.social_doubles_ladders
    WHERE id = v_event.social_doubles_ladder_id AND competition_type = 'league';
    IF NOT FOUND THEN RAISE EXCEPTION 'This tournament is not a League event'; END IF;
    v_expected_category := CASE v_league_gender
      WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' ELSE 'mixed' END;
    IF v_event.tournament_format <> 'doubles' OR p_category <> v_expected_category THEN
      RAISE EXCEPTION 'League participants must use the League doubles category';
    END IF;
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Select an approved member to add to a League event';
    END IF;
  ELSIF v_event.tournament_format = 'singles' THEN
    IF p_category NOT IN ('all', 'men', 'women') OR NOT (
      coalesce(v_event.tournament_config->'categories', '["all","men","women"]'::jsonb) ? p_category
    ) THEN RAISE EXCEPTION 'This singles category is not enabled'; END IF;
  ELSIF v_event.tournament_format = 'team' THEN
    IF p_category <> 'team' THEN RAISE EXCEPTION 'Team tournament participants use the team category'; END IF;
  ELSIF p_category NOT IN ('mixed', 'men', 'women') OR NOT (
    coalesce(v_event.tournament_config->'categories', '["mixed","men","women"]'::jsonb) ? p_category
  ) THEN
    RAISE EXCEPTION 'This tournament category is not enabled';
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id
      AND account_kind = 'member' AND application_status = 'approved';
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an approved member'; END IF;
    v_name := coalesce(nullif(v_profile.full_name, ''), v_profile.email);
    v_email := v_profile.email;
    v_phone := v_profile.phone;
    v_gender := coalesce(v_profile.gender, p_gender);
    IF v_league_gender IS NOT NULL AND NOT public.has_active_paid_membership(v_user_id) THEN
      RAISE EXCEPTION 'An active paid membership is required to join a League event';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_user_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
      AND user_id = v_user_id AND category = p_category AND status IN ('registered', 'provisional')) THEN
      RAISE EXCEPTION 'This player is already registered in this category';
    END IF;
    IF v_event.tournament_format = 'team' AND EXISTS (
      SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND status IN ('registered', 'provisional')
    ) THEN RAISE EXCEPTION 'This player is already registered for this team tournament'; END IF;
    IF v_event.tournament_format IN ('doubles', 'singles') AND (
      SELECT count(*) FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND status IN ('registered', 'provisional')
    ) >= 2 THEN RAISE EXCEPTION 'A player may enter no more than two categories'; END IF;
    IF (p_category = 'men' AND v_gender = 'female') OR (p_category = 'women' AND v_gender = 'male') THEN
      RAISE EXCEPTION 'The profile gender is not eligible for this category';
    END IF;
    IF (p_category = 'men' AND EXISTS (
      SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND category = 'women' AND status IN ('registered', 'provisional')
    )) OR (p_category = 'women' AND EXISTS (
      SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND category = 'men' AND status IN ('registered', 'provisional')
    )) THEN RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles'; END IF;
  ELSIF v_name IS NULL THEN
    RAISE EXCEPTION 'Enter a participant name or select a member';
  END IF;
  IF v_event.tournament_format='singles'
    AND ((p_category='men' AND v_gender='female') OR (p_category='women' AND v_gender='male')) THEN
    RAISE EXCEPTION 'The participant gender is not eligible for this singles category';
  END IF;

  v_price := public.calculate_tournament_registration_price(p_event_id, v_user_id, p_category, false);
  INSERT INTO public.tournament_participants(
    event_id, user_id, category, amount_cents, base_amount_cents, discount_cents, pricing_details,
    payment_status, display_name, email, phone, gender
  ) VALUES (
    p_event_id, v_user_id, p_category, (v_price->>'amountCents')::integer,
    (v_price->>'baseAmountCents')::integer, (v_price->>'discountCents')::integer, v_price,
    CASE WHEN (v_price->>'amountCents')::integer = 0 THEN 'not_required' ELSE 'pending' END,
    v_name, v_email, v_phone, v_gender
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('participantId', v_id, 'pricingDetails', v_price);
END;
$$;

REVOKE ALL ON FUNCTION public.register_tournament_participant_admin(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_participant_admin(uuid,uuid,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  coalesce(profile.application_status='approved' AND profile.account_kind='member',false) AS is_member,
  false AS captain_requested,profile.avatar_url,
  (coalesce(profile.show_birthday_emoji,false) AND profile.date_of_birth IS NOT NULL
    AND to_char(profile.date_of_birth,'MM-DD')=to_char((now() AT TIME ZONE 'America/Vancouver')::date,'MM-DD')) AS birthday_emoji_visible,p.user_id,
  p.group_number,p.seed
FROM public.tournament_participants p JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered' AND p.confirmation_status='confirmed'
  AND (p.user_id IS NULL OR profile.account_kind IN ('member','event_guest'))
  AND (e.tournament_details_public=true OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid() AND viewer.application_status='approved' AND viewer.account_kind='member')
    OR EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'));
GRANT SELECT ON public.tournament_public_participants TO anon,authenticated;

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id,m.event_id,m.category,m.phase,m.group_number,m.round_number,m.match_number,
  m.pair_one_id,m.pair_two_id,m.team_one_id,m.team_two_id,m.scheduled_at,m.court_number,
  m.score_sets,m.winner_side,m.team_points_one,m.team_points_two,m.status,m.notes,
  team_one.name AS team_one_name,team_two.name AS team_two_name,
  CASE WHEN m.player_one_participant_id IS NOT NULL THEN single_one.display_name
    WHEN public.is_event_manager() OR m.team_one_lineup_public OR now()>=coalesce(m.scheduled_at,e.starts_at) OR EXISTS (
      SELECT 1 FROM public.tournament_participants own WHERE own.event_id=m.event_id AND own.team_id=m.team_one_id AND own.user_id=auth.uid() AND own.status='registered' AND own.confirmation_status='confirmed')
      THEN coalesce(side_one.players,pair_one.player_one_name||' + '||pair_one.player_two_name)
    ELSE coalesce(pair_one.player_one_name||' + '||pair_one.player_two_name,'') END AS player_one_name,
  NULL::text AS player_two_name,
  CASE WHEN m.player_two_participant_id IS NOT NULL THEN single_two.display_name
    WHEN public.is_event_manager() OR m.team_two_lineup_public OR now()>=coalesce(m.scheduled_at,e.starts_at) OR EXISTS (
      SELECT 1 FROM public.tournament_participants own WHERE own.event_id=m.event_id AND own.team_id=m.team_two_id AND own.user_id=auth.uid() AND own.status='registered' AND own.confirmation_status='confirmed')
      THEN coalesce(side_two.players,pair_two.player_one_name||' + '||pair_two.player_two_name)
    ELSE coalesce(pair_two.player_one_name||' + '||pair_two.player_two_name,'') END AS opponent_one_name,
  NULL::text AS opponent_two_name,m.team_one_lineup_public,m.team_two_lineup_public,
  m.player_one_participant_id,m.player_two_participant_id
FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id AND e.status='published'
LEFT JOIN public.tournament_teams team_one ON team_one.id=m.team_one_id
LEFT JOIN public.tournament_teams team_two ON team_two.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs pair_one ON pair_one.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs pair_two ON pair_two.id=m.pair_two_id
LEFT JOIN public.tournament_participants single_one ON single_one.id=m.player_one_participant_id
LEFT JOIN public.tournament_participants single_two ON single_two.id=m.player_two_participant_id
LEFT JOIN LATERAL (SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id LEFT JOIN public.profiles profile ON profile.id=p.user_id WHERE mp.match_id=m.id AND mp.side=1 AND (p.user_id IS NULL OR profile.account_kind IN ('member','event_guest'))) side_one ON true
LEFT JOIN LATERAL (SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id LEFT JOIN public.profiles profile ON profile.id=p.user_id WHERE mp.match_id=m.id AND mp.side=2 AND (p.user_id IS NULL OR profile.account_kind IN ('member','event_guest'))) side_two ON true
WHERE e.tournament_details_public=true OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid() AND viewer.application_status='approved' AND viewer.account_kind='member')
  OR EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered');
GRANT SELECT ON public.tournament_public_matches TO anon,authenticated;
