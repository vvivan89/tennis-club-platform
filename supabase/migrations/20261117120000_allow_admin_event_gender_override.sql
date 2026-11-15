-- Allow event managers to supply an event-only gender when a legacy member profile has none.
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
    IF v_event.tournament_format = 'doubles' AND (
      SELECT count(*) FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND status IN ('registered', 'provisional')
    ) >= 2 THEN RAISE EXCEPTION 'A player may enter no more than two doubles categories'; END IF;
    IF (p_category = 'men' AND v_gender = 'female') OR (p_category = 'women' AND v_gender = 'male') THEN
      RAISE EXCEPTION 'The profile gender is not eligible for this doubles category';
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

REVOKE ALL ON FUNCTION public.register_tournament_participant_admin(uuid,uuid,text,text,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_participant_admin(uuid,uuid,text,text,text,text,text)
  TO authenticated;
