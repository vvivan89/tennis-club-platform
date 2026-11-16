-- Add Mixed doubles as a persistent category for social ladders and Leagues.
ALTER TABLE public.social_doubles_ladders
  DROP CONSTRAINT IF EXISTS social_doubles_ladders_gender_check;
ALTER TABLE public.social_doubles_ladders
  ADD CONSTRAINT social_doubles_ladders_gender_check CHECK (gender IN ('male', 'female', 'mixed'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_ladder_gender_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_ladder_gender_check
  CHECK (ladder_gender IS NULL OR ladder_gender IN ('male', 'female', 'mixed'));

COMMENT ON TABLE public.social_doubles_ladders IS
  'Seasonal doubles Ladder or League identities with men, women, or mixed categories.';

-- Do not encode Mixed as an event gender restriction: Mixed permits all players to register,
-- while the pair rules below enforce one male and one female on each doubles side.
CREATE OR REPLACE FUNCTION public.sync_league_config_to_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.competition_type = 'league'
    AND (OLD.tournament_config IS DISTINCT FROM NEW.tournament_config
      OR OLD.gender IS DISTINCT FROM NEW.gender
      OR OLD.tournament_rules_html IS DISTINCT FROM NEW.tournament_rules_html) THEN
    UPDATE public.events
    SET tournament_config = NEW.tournament_config,
        tournament_rules_html = NEW.tournament_rules_html,
        gender_restriction = CASE WHEN NEW.gender IN ('male', 'female') THEN NEW.gender ELSE NULL END,
        ladder_gender = NEW.gender
    WHERE social_doubles_ladder_id = NEW.id AND event_type = 'tournament';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_league_participant_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gender text;
BEGIN
  SELECT league.gender INTO v_gender
  FROM public.events event
  JOIN public.social_doubles_ladders league
    ON league.id = event.social_doubles_ladder_id AND league.competition_type = 'league'
  WHERE event.id = NEW.event_id AND event.event_type = 'tournament';
  IF v_gender IS NOT NULL THEN
    NEW.category := CASE v_gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' ELSE 'mixed' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_league_participant_category ON public.tournament_participants;
CREATE TRIGGER normalize_league_participant_category
BEFORE INSERT OR UPDATE OF event_id, category ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.normalize_league_participant_category();

CREATE OR REPLACE FUNCTION public.normalize_league_pair_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gender text;
BEGIN
  SELECT league.gender INTO v_gender
  FROM public.events event
  JOIN public.social_doubles_ladders league
    ON league.id = event.social_doubles_ladder_id AND league.competition_type = 'league'
  WHERE event.id = NEW.event_id AND event.event_type = 'tournament';
  IF v_gender IS NOT NULL THEN
    NEW.category := CASE v_gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' ELSE 'mixed' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS normalize_league_pair_category ON public.tournament_pairs;
CREATE TRIGGER normalize_league_pair_category
BEFORE INSERT OR UPDATE OF event_id, category ON public.tournament_pairs
FOR EACH ROW EXECUTE FUNCTION public.normalize_league_pair_category();

CREATE OR REPLACE FUNCTION public.require_established_league_pair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league uuid;
  v_gender text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.status NOT IN ('registered', 'provisional') THEN RETURN NEW; END IF;
  SELECT event.social_doubles_ladder_id, league.gender INTO v_league, v_gender
  FROM public.events event
  JOIN public.social_doubles_ladders league
    ON league.id = event.social_doubles_ladder_id AND league.competition_type = 'league'
  WHERE event.id = NEW.event_id AND event.event_type = 'tournament';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE v_gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' ELSE 'mixed' END) THEN
    RAISE EXCEPTION 'League registrations must use the League category';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.league_teams team
    WHERE team.league_id = v_league AND team.status = 'active'
      AND NEW.user_id IN (team.player_one_id, team.player_two_id)
  ) THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tournament_pairs pair
    JOIN public.tournament_participants one ON one.id = pair.player_one_id
    JOIN public.tournament_participants two ON two.id = pair.player_two_id
    JOIN public.league_teams team ON team.league_id = v_league AND team.status = 'active'
      AND ((team.player_one_id = one.user_id AND team.player_two_id = two.user_id)
        OR (team.player_one_id = two.user_id AND team.player_two_id = one.user_id))
    WHERE pair.event_id = NEW.event_id AND pair.category = NEW.category AND pair.status = 'active'
      AND NEW.user_id IN (one.user_id, two.user_id)
  ) THEN RAISE EXCEPTION 'Established League members must register with their confirmed partner'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league uuid;
  v_gender text;
  v_allow_guest boolean;
  v_one uuid;
  v_two uuid;
  v_one_status text;
  v_two_status text;
  v_one_confirm text;
  v_two_confirm text;
  v_one_email text;
  v_two_email text;
  v_one_gender text;
  v_two_gender text;
  v_member_team public.league_teams%rowtype;
BEGIN
  SELECT event.social_doubles_ladder_id, league.gender, event.allow_non_member_registration
    INTO v_league, v_gender, v_allow_guest
  FROM public.events event
  JOIN public.social_doubles_ladders league
    ON league.id = event.social_doubles_ladder_id AND league.competition_type = 'league'
  WHERE event.id = NEW.event_id AND event.event_type = 'tournament' AND event.tournament_format = 'doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE v_gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' ELSE 'mixed' END) THEN
    RAISE EXCEPTION 'League pairs must use the League category';
  END IF;

  SELECT one.user_id, two.user_id, one.status, two.status,
    one.confirmation_status, two.confirmation_status, one.email, two.email,
    coalesce(profile_one.gender, one.gender_override, one.gender),
    coalesce(profile_two.gender, two.gender_override, two.gender)
  INTO v_one, v_two, v_one_status, v_two_status, v_one_confirm, v_two_confirm,
    v_one_email, v_two_email, v_one_gender, v_two_gender
  FROM public.tournament_participants one
  CROSS JOIN public.tournament_participants two
  LEFT JOIN public.profiles profile_one ON profile_one.id = one.user_id
  LEFT JOIN public.profiles profile_two ON profile_two.id = two.user_id
  WHERE one.id = NEW.player_one_id AND two.id = NEW.player_two_id;

  IF (v_one IS NULL AND NOT (v_allow_guest AND v_one_status = 'provisional'
      AND v_one_confirm = 'pending' AND v_one_email IS NOT NULL))
    OR (v_two IS NULL AND NOT (v_allow_guest AND v_two_status = 'provisional'
      AND v_two_confirm = 'pending' AND v_two_email IS NOT NULL)) THEN
    RAISE EXCEPTION 'League teams require two verified players or an invited event-only partner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles profile WHERE profile.id IN (v_one, v_two)
      AND NOT (profile.application_status = 'approved' AND profile.account_kind = 'member')
      AND NOT (v_allow_guest AND profile.account_kind IN ('event_guest', 'member'))
  ) THEN RAISE EXCEPTION 'League participants must be approved members or verified event-only registrants'; END IF;

  IF v_gender = 'mixed' AND NOT (
    (v_one_gender = 'male' AND v_two_gender = 'female')
    OR (v_one_gender = 'female' AND v_two_gender = 'male')
  ) THEN
    RAISE EXCEPTION 'Mixed League teams require exactly one male and one female player';
  END IF;

  SELECT * INTO v_member_team FROM public.league_teams team
  WHERE team.league_id = v_league AND team.status = 'active'
    AND (team.player_one_id IN (v_one, v_two) OR team.player_two_id IN (v_one, v_two))
  LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id = v_one AND v_member_team.player_two_id = v_two)
      OR (v_member_team.player_one_id = v_two AND v_member_team.player_two_id = v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.league_teams team WHERE team.id = NEW.league_team_id AND team.league_id = v_league
        AND ((team.player_one_id = v_one AND team.player_two_id = v_two)
          OR (team.player_one_id = v_two AND team.player_two_id = v_one))
    ) THEN RAISE EXCEPTION 'League team does not match this event pair'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_league_single_event_entry(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_league public.social_doubles_ladders%rowtype;
  v_profile public.profiles%rowtype;
  v_category text;
  v_participant_id uuid;
  v_amount integer;
  v_payment_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in with an approved member account to register for a League event'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND event_type = 'tournament';
  IF NOT FOUND OR v_event.social_doubles_ladder_id IS NULL THEN RAISE EXCEPTION 'League event was not found'; END IF;
  SELECT * INTO v_league FROM public.social_doubles_ladders
  WHERE id = v_event.social_doubles_ladder_id AND competition_type = 'league';
  IF NOT FOUND OR v_event.tournament_format <> 'doubles' THEN RAISE EXCEPTION 'This is not a League doubles event'; END IF;
  IF v_event.status <> 'published' OR now() < v_event.registration_opens_at
    OR (v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at)
    OR now() >= v_event.starts_at THEN RAISE EXCEPTION 'League event registration is closed'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user AND application_status = 'approved';
  IF NOT FOUND OR NOT public.has_active_paid_membership(v_user) THEN
    RAISE EXCEPTION 'An approved profile and active paid membership are required for League registration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_teams team WHERE team.league_id = v_league.id
    AND team.status = 'active' AND v_user IN (team.player_one_id, team.player_two_id)) THEN
    RAISE EXCEPTION 'You have a confirmed League partner. Register your team instead';
  END IF;
  v_category := CASE v_league.gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' ELSE 'mixed' END;
  IF v_league.gender <> 'mixed' AND v_profile.gender IS NOT NULL
    AND v_profile.gender <> (CASE WHEN v_category = 'men' THEN 'male' ELSE 'female' END) THEN
    RAISE EXCEPTION 'Your profile gender does not match this League category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants participant
    WHERE participant.event_id = p_event_id AND participant.user_id = v_user
      AND participant.category = v_category AND participant.status = 'registered') THEN
    RAISE EXCEPTION 'You are already registered for this League event';
  END IF;
  IF (SELECT count(*) FROM public.tournament_participants participant
    WHERE participant.event_id = p_event_id AND participant.status = 'registered') + 1 > v_event.capacity THEN
    RAISE EXCEPTION 'League event registration is full';
  END IF;
  v_amount := greatest(coalesce(v_event.price_cents, 0), 0);
  INSERT INTO public.tournament_participants(
    event_id, user_id, category, display_name, email, phone, gender, amount_cents, payment_status
  ) VALUES (
    p_event_id, v_user, v_category, coalesce(nullif(v_profile.full_name, ''), v_profile.email),
    v_profile.email, v_profile.phone, v_profile.gender, v_amount,
    CASE WHEN v_amount = 0 THEN 'not_required' ELSE 'pending' END
  ) RETURNING id, amount_cents, payment_status INTO v_participant_id, v_amount, v_payment_status;
  RETURN jsonb_build_object('participantId', v_participant_id, 'amountCents', v_amount,
    'paymentStatus', v_payment_status, 'singleRegistration', true);
END;
$$;
REVOKE ALL ON FUNCTION public.register_league_single_event_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_league_single_event_entry(uuid) TO authenticated;

-- The guest-registration pricing wrapper calls this stable internal name. Translate only the
-- category for Mixed Leagues, preserving all existing guest validation and email behavior.
ALTER FUNCTION public.register_event_guest_tournament_entry_discount_base(
  uuid, text, text, text, text, numeric, text, text, text, text, numeric
) RENAME TO register_event_guest_tournament_entry_pre_mixed_base;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry_pre_mixed_base(
  uuid, text, text, text, text, numeric, text, text, text, text, numeric
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.register_event_guest_tournament_entry_discount_base(
  p_event_id uuid, p_category text, p_display_name text, p_phone text, p_gender text,
  p_tennis_skill_level numeric, p_partner_name text DEFAULT NULL, p_partner_email text DEFAULT NULL,
  p_partner_phone text DEFAULT NULL, p_partner_gender text DEFAULT NULL,
  p_partner_skill_level numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_category text := p_category;
  v_gender text;
BEGIN
  SELECT league.gender INTO v_gender
  FROM public.events event
  JOIN public.social_doubles_ladders league
    ON league.id = event.social_doubles_ladder_id AND league.competition_type = 'league'
  WHERE event.id = p_event_id AND event.event_type = 'tournament';
  IF v_gender = 'mixed' THEN v_category := 'mixed'; END IF;
  RETURN public.register_event_guest_tournament_entry_pre_mixed_base(
    p_event_id, v_category, p_display_name, p_phone, p_gender, p_tennis_skill_level,
    p_partner_name, p_partner_email, p_partner_phone, p_partner_gender, p_partner_skill_level
  );
END;
$$;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry_discount_base(
  uuid, text, text, text, text, numeric, text, text, text, text, numeric
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_invalid_mixed_league_gender_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.gender IS DISTINCT FROM OLD.gender AND EXISTS (
    SELECT 1
    FROM public.league_teams team
    JOIN public.social_doubles_ladders league
      ON league.id = team.league_id AND league.competition_type = 'league' AND league.gender = 'mixed'
    JOIN public.profiles partner
      ON partner.id = CASE WHEN team.player_one_id = NEW.id THEN team.player_two_id ELSE team.player_one_id END
    WHERE team.status = 'active' AND NEW.id IN (team.player_one_id, team.player_two_id)
      AND NOT ((NEW.gender = 'male' AND partner.gender = 'female')
        OR (NEW.gender = 'female' AND partner.gender = 'male'))
  ) THEN
    RAISE EXCEPTION 'This gender change would invalidate an active Mixed League team';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_invalid_mixed_league_gender_change ON public.profiles;
CREATE TRIGGER prevent_invalid_mixed_league_gender_change
BEFORE UPDATE OF gender ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_invalid_mixed_league_gender_change();

CREATE OR REPLACE FUNCTION public.validate_mixed_social_doubles_ladder_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gender text;
  v_one text;
  v_two text;
  v_three text;
  v_four text;
  v_count integer;
BEGIN
  SELECT league.gender INTO v_gender
  FROM public.events event
  JOIN public.social_doubles_ladders league
    ON league.id = event.social_doubles_ladder_id AND league.competition_type = 'ladder'
  WHERE event.id = NEW.event_id AND event.event_type = 'social_doubles_ladder';
  IF v_gender IS DISTINCT FROM 'mixed' THEN RETURN NEW; END IF;
  IF NEW.player_one_registration_id IS NULL OR NEW.player_two_registration_id IS NULL
    OR NEW.player_three_registration_id IS NULL OR NEW.player_four_registration_id IS NULL THEN
    RAISE EXCEPTION 'Mixed Ladder scores require two players on each doubles side';
  END IF;

  SELECT count(*),
    max(profile.gender) FILTER (WHERE picked.slot = 1),
    max(profile.gender) FILTER (WHERE picked.slot = 2),
    max(profile.gender) FILTER (WHERE picked.slot = 3),
    max(profile.gender) FILTER (WHERE picked.slot = 4)
  INTO v_count, v_one, v_two, v_three, v_four
  FROM (VALUES
    (1, NEW.player_one_registration_id), (2, NEW.player_two_registration_id),
    (3, NEW.player_three_registration_id), (4, NEW.player_four_registration_id)
  ) AS picked(slot, registration_id)
  JOIN public.registrations registration
    ON registration.id = picked.registration_id AND registration.event_id = NEW.event_id
    AND registration.status = 'confirmed'
  JOIN public.profiles profile ON profile.id = registration.user_id;

  IF v_count <> 4 THEN RAISE EXCEPTION 'Mixed Ladder scores require four confirmed registered players'; END IF;
  IF NOT (
    ((v_one = 'male' AND v_two = 'female') OR (v_one = 'female' AND v_two = 'male'))
    AND ((v_three = 'male' AND v_four = 'female') OR (v_three = 'female' AND v_four = 'male'))
  ) THEN
    RAISE EXCEPTION 'Each Mixed Ladder doubles side requires exactly one male and one female player';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_mixed_social_doubles_ladder_score ON public.event_scores;
CREATE TRIGGER validate_mixed_social_doubles_ladder_score
BEFORE INSERT OR UPDATE OF player_one_registration_id, player_two_registration_id,
  player_three_registration_id, player_four_registration_id, event_id ON public.event_scores
FOR EACH ROW EXECUTE FUNCTION public.validate_mixed_social_doubles_ladder_score();
