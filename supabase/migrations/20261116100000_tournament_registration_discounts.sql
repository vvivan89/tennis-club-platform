ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS base_amount_cents integer NOT NULL DEFAULT 0 CHECK (base_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN IF NOT EXISTS pricing_details jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.tournament_participants
SET base_amount_cents = amount_cents,
    pricing_details = jsonb_build_object(
      'baseAmountCents', amount_cents,
      'discountCents', 0,
      'amountCents', amount_cents,
      'appliedDiscounts', '[]'::jsonb
    )
WHERE pricing_details = '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.set_tournament_participant_pricing_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.pricing_details IS NULL OR NEW.pricing_details = '{}'::jsonb THEN
    NEW.base_amount_cents := greatest(coalesce(NEW.amount_cents, 0), 0);
    NEW.discount_cents := 0;
    NEW.pricing_details := jsonb_build_object(
      'baseAmountCents', NEW.base_amount_cents,
      'discountCents', 0,
      'amountCents', NEW.base_amount_cents,
      'appliedDiscounts', '[]'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tournament_participant_pricing_defaults ON public.tournament_participants;
CREATE TRIGGER set_tournament_participant_pricing_defaults
BEFORE INSERT OR UPDATE OF amount_cents, pricing_details ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.set_tournament_participant_pricing_defaults();

CREATE OR REPLACE FUNCTION public.calculate_tournament_registration_price(
  p_event_id uuid,
  p_user_id uuid,
  p_category text,
  p_pair_registration boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.events%rowtype;
  v_rules jsonb;
  v_rule jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_item jsonb;
  v_key text;
  v_label text;
  v_type text;
  v_base integer;
  v_discount integer := 0;
  v_requested integer;
  v_remaining integer;
  v_other_categories integer := 0;
  v_member boolean := false;
  v_stack boolean := false;
  v_amount integer;
  v_rule_order text[] := ARRAY['second_category', 'pair_registration', 'approved_member'];
BEGIN
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id AND event_type = 'tournament';
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found'; END IF;

  v_base := greatest(coalesce(v_event.price_cents, 0), 0);
  v_rules := coalesce(v_event.tournament_config->'registration_discounts', '{}'::jsonb);
  v_stack := coalesce((v_rules->>'stack_enabled')::boolean, false);
  IF p_user_id IS NOT NULL THEN
    SELECT count(DISTINCT category) INTO v_other_categories
    FROM public.tournament_participants
    WHERE event_id = p_event_id
      AND user_id = p_user_id
      AND category <> p_category
      AND status IN ('registered', 'provisional');
    SELECT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id
        AND account_kind = 'member'
        AND application_status = 'approved'
    ) INTO v_member;
  END IF;

  FOREACH v_key IN ARRAY v_rule_order LOOP
    v_rule := v_rules->v_key;
    IF coalesce((v_rule->>'enabled')::boolean, false)
      AND (v_key <> 'second_category' OR (p_category <> 'team' AND v_other_categories = 1))
      AND (v_key <> 'pair_registration' OR p_pair_registration)
      AND (v_key <> 'approved_member' OR v_member)
    THEN
      v_type := coalesce(v_rule->>'type', 'percent');
      IF v_type = 'fixed' THEN
        v_requested := greatest(coalesce((v_rule->>'amount_cents')::integer, 0), 0);
      ELSE
        v_requested := greatest(least(
          round(v_base::numeric * greatest(least(coalesce((v_rule->>'percent')::numeric, 0), 100), 0) / 100)::integer,
          v_base
        ), 0);
      END IF;
      v_requested := least(v_requested, v_base);
      IF v_requested > 0 THEN
        v_label := CASE v_key
          WHEN 'second_category' THEN 'Second category'
          WHEN 'pair_registration' THEN 'Pair registration'
          ELSE 'Approved club member'
        END;
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'key', v_key, 'label', v_label, 'discountCents', v_requested
        ));
      END IF;
    END IF;
  END LOOP;

  v_remaining := v_base;
  IF v_stack THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_candidates) LOOP
      v_amount := least(v_remaining, (v_item->>'discountCents')::integer);
      IF v_amount > 0 THEN
        v_discount := v_discount + v_amount;
        v_remaining := v_remaining - v_amount;
        v_applied := v_applied || jsonb_build_array(v_item || jsonb_build_object('discountCents', v_amount));
      END IF;
    END LOOP;
  ELSE
    SELECT value INTO v_item
    FROM jsonb_array_elements(v_candidates)
    ORDER BY (value->>'discountCents')::integer DESC
    LIMIT 1;
    IF v_item IS NOT NULL THEN
      v_discount := least(v_base, (v_item->>'discountCents')::integer);
      IF v_discount > 0 THEN
        v_applied := jsonb_build_array(v_item || jsonb_build_object('discountCents', v_discount));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'baseAmountCents', v_base,
    'discountCents', v_discount,
    'amountCents', greatest(v_base - v_discount, 0),
    'appliedDiscounts', v_applied
  );
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_tournament_registration_price(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;

-- Keep the existing validation/registration logic, then apply server-calculated pricing.
ALTER FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric)
  RENAME TO register_tournament_entry_discount_base;
REVOKE ALL ON FUNCTION public.register_tournament_entry_discount_base(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.register_tournament_entry(
  p_event_id uuid, p_category text, p_display_name text, p_email text, p_phone text, p_gender text,
  p_partner_participant_id uuid, p_partner_name text, p_partner_email text, p_partner_phone text,
  p_partner_gender text, p_partner_user_id uuid, p_tennis_skill_level numeric,
  p_partner_tennis_skill_level numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_partner_user uuid := p_partner_user_id;
  v_existing_partner uuid := p_partner_participant_id;
  v_result jsonb;
  v_own_id uuid;
  v_partner_id uuid;
  v_own_user uuid;
  v_partner_entry_user uuid;
  v_own_price jsonb;
  v_partner_price jsonb;
  v_own_status text;
  v_partner_status text;
  v_partner_amount integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in before registering'; END IF;
  IF v_partner_user IS NULL AND nullif(btrim(p_partner_email), '') IS NOT NULL THEN
    SELECT id INTO v_partner_user FROM public.profiles WHERE lower(email) = lower(btrim(p_partner_email)) LIMIT 1;
  END IF;
  IF v_partner_user IS NULL AND v_existing_partner IS NOT NULL THEN
    SELECT user_id INTO v_partner_user FROM public.tournament_participants WHERE id = v_existing_partner;
  END IF;
  IF v_partner_user IS NOT NULL AND v_partner_user <> v_user AND v_partner_user < v_user THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_partner_user::text, 0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_user::text, 0));
  IF v_partner_user IS NOT NULL AND v_partner_user <> v_user AND v_user < v_partner_user THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_partner_user::text, 0));
  END IF;
  IF v_existing_partner IS NULL AND v_partner_user IS NOT NULL THEN
    SELECT id INTO v_existing_partner FROM public.tournament_participants
    WHERE event_id = p_event_id AND category = p_category AND user_id = v_partner_user
      AND status IN ('registered', 'provisional')
    LIMIT 1;
  END IF;
  IF v_existing_partner IS NULL AND nullif(btrim(p_partner_email), '') IS NOT NULL THEN
    SELECT id INTO v_existing_partner FROM public.tournament_participants
    WHERE event_id = p_event_id AND category = p_category AND lower(email) = lower(btrim(p_partner_email))
      AND status IN ('registered', 'provisional')
    LIMIT 1;
  END IF;

  v_result := public.register_tournament_entry_discount_base(
    p_event_id, p_category, p_display_name, p_email, p_phone, p_gender,
    p_partner_participant_id, p_partner_name, p_partner_email, p_partner_phone,
    p_partner_gender, p_partner_user_id, p_tennis_skill_level, p_partner_tennis_skill_level
  );
  v_own_id := (v_result->>'participantId')::uuid;
  v_partner_id := nullif(v_result->>'partnerParticipantId', '')::uuid;
  SELECT user_id INTO v_own_user FROM public.tournament_participants WHERE id = v_own_id;
  v_own_price := public.calculate_tournament_registration_price(
    p_event_id, v_own_user, p_category, v_partner_id IS NOT NULL
  );
  UPDATE public.tournament_participants
  SET base_amount_cents = (v_own_price->>'baseAmountCents')::integer,
      discount_cents = (v_own_price->>'discountCents')::integer,
      pricing_details = v_own_price,
      amount_cents = (v_own_price->>'amountCents')::integer,
      payment_status = CASE WHEN (v_own_price->>'amountCents')::integer = 0 THEN 'not_required'
        WHEN payment_status = 'not_required' THEN 'pending' ELSE payment_status END
  WHERE id = v_own_id
  RETURNING payment_status INTO v_own_status;

  IF v_partner_id IS NOT NULL THEN
    SELECT user_id INTO v_partner_entry_user FROM public.tournament_participants WHERE id = v_partner_id;
    IF v_partner_id IS DISTINCT FROM v_existing_partner THEN
      v_partner_price := public.calculate_tournament_registration_price(
        p_event_id, v_partner_entry_user, p_category, true
      );
      UPDATE public.tournament_participants
      SET base_amount_cents = (v_partner_price->>'baseAmountCents')::integer,
          discount_cents = (v_partner_price->>'discountCents')::integer,
          pricing_details = v_partner_price,
          amount_cents = (v_partner_price->>'amountCents')::integer,
          payment_status = CASE WHEN (v_partner_price->>'amountCents')::integer = 0 THEN 'not_required'
            WHEN payment_status = 'not_required' THEN 'pending' ELSE payment_status END
      WHERE id = v_partner_id;
    ELSE
      SELECT pricing_details INTO v_partner_price FROM public.tournament_participants WHERE id = v_partner_id;
    END IF;
    SELECT amount_cents, payment_status INTO v_partner_amount, v_partner_status
    FROM public.tournament_participants WHERE id = v_partner_id;
  END IF;

  RETURN v_result || jsonb_build_object(
    'amountCents', (v_own_price->>'amountCents')::integer,
    'baseAmountCents', (v_own_price->>'baseAmountCents')::integer,
    'discountCents', (v_own_price->>'discountCents')::integer,
    'pricingDetails', v_own_price,
    'paymentStatus', v_own_status,
    'partnerAmountCents', v_partner_amount,
    'partnerPaymentStatus', v_partner_status,
    'partnerDiscountCents', nullif(v_partner_price->>'discountCents', '')::integer,
    'partnerPricingDetails', v_partner_price
  );
END;
$$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric)
  TO authenticated;

ALTER FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric)
  RENAME TO register_event_guest_tournament_entry_discount_base;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry_discount_base(uuid,text,text,text,text,numeric,text,text,text,text,numeric)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.register_event_guest_tournament_entry(
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
  v_user uuid := auth.uid();
  v_partner_user uuid;
  v_existing_partner uuid;
  v_result jsonb;
  v_own_id uuid;
  v_partner_id uuid;
  v_own_price jsonb;
  v_partner_price jsonb;
  v_own_user uuid;
  v_partner_entry_user uuid;
  v_partner_amount integer;
  v_own_status text;
  v_partner_status text;
  v_event_format text;
  v_existing_category_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Verify your email before registering'; END IF;
  IF nullif(btrim(p_partner_email), '') IS NOT NULL THEN
    SELECT id INTO v_partner_user FROM public.profiles WHERE lower(email) = lower(btrim(p_partner_email)) LIMIT 1;
    SELECT id INTO v_existing_partner FROM public.tournament_participants
    WHERE event_id = p_event_id AND category = p_category
      AND lower(email) = lower(btrim(p_partner_email)) AND status IN ('registered', 'provisional')
    LIMIT 1;
  END IF;
  IF v_partner_user IS NOT NULL AND v_partner_user <> v_user AND v_partner_user < v_user THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_partner_user::text, 0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_user::text, 0));
  IF v_partner_user IS NOT NULL AND v_partner_user <> v_user AND v_user < v_partner_user THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_partner_user::text, 0));
  END IF;
  SELECT tournament_format INTO v_event_format FROM public.events WHERE id = p_event_id;
  SELECT count(DISTINCT category) INTO v_existing_category_count
  FROM public.tournament_participants
  WHERE event_id = p_event_id AND user_id = v_user AND status IN ('registered', 'provisional');
  IF v_event_format = 'team' AND v_existing_category_count > 0 THEN
    RAISE EXCEPTION 'You are already registered for this team tournament';
  END IF;
  IF v_event_format = 'doubles' AND v_existing_category_count >= 2 THEN
    RAISE EXCEPTION 'A player may enter no more than two doubles categories';
  END IF;
  IF (p_category = 'men' AND EXISTS (
    SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id AND user_id = v_user
      AND category = 'women' AND status IN ('registered', 'provisional')
  )) OR (p_category = 'women' AND EXISTS (
    SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id AND user_id = v_user
      AND category = 'men' AND status IN ('registered', 'provisional')
  )) THEN
    RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles';
  END IF;
  v_result := public.register_event_guest_tournament_entry_discount_base(
    p_event_id, p_category, p_display_name, p_phone, p_gender, p_tennis_skill_level,
    p_partner_name, p_partner_email, p_partner_phone, p_partner_gender, p_partner_skill_level
  );
  v_own_id := (v_result->>'participantId')::uuid;
  v_partner_id := nullif(v_result->>'partnerParticipantId', '')::uuid;
  SELECT user_id INTO v_own_user FROM public.tournament_participants WHERE id = v_own_id;
  v_own_price := public.calculate_tournament_registration_price(
    p_event_id, v_own_user, p_category, v_partner_id IS NOT NULL
  );
  UPDATE public.tournament_participants
  SET base_amount_cents = (v_own_price->>'baseAmountCents')::integer,
      discount_cents = (v_own_price->>'discountCents')::integer,
      pricing_details = v_own_price,
      amount_cents = (v_own_price->>'amountCents')::integer,
      payment_status = CASE WHEN (v_own_price->>'amountCents')::integer = 0 THEN 'not_required'
        WHEN payment_status = 'not_required' THEN 'pending' ELSE payment_status END
  WHERE id = v_own_id
  RETURNING payment_status INTO v_own_status;
  IF v_partner_id IS NOT NULL THEN
    SELECT user_id INTO v_partner_entry_user FROM public.tournament_participants WHERE id = v_partner_id;
    IF v_partner_id IS DISTINCT FROM v_existing_partner THEN
      v_partner_price := public.calculate_tournament_registration_price(p_event_id, v_partner_entry_user, p_category, true);
      UPDATE public.tournament_participants
      SET base_amount_cents = (v_partner_price->>'baseAmountCents')::integer,
          discount_cents = (v_partner_price->>'discountCents')::integer,
          pricing_details = v_partner_price,
          amount_cents = (v_partner_price->>'amountCents')::integer,
          payment_status = CASE WHEN (v_partner_price->>'amountCents')::integer = 0 THEN 'not_required'
            WHEN payment_status = 'not_required' THEN 'pending' ELSE payment_status END
      WHERE id = v_partner_id;
    ELSE
      SELECT pricing_details INTO v_partner_price FROM public.tournament_participants WHERE id = v_partner_id;
    END IF;
    SELECT amount_cents, payment_status INTO v_partner_amount, v_partner_status
    FROM public.tournament_participants WHERE id = v_partner_id;
  END IF;
  RETURN v_result || jsonb_build_object(
    'amountCents', (v_own_price->>'amountCents')::integer,
    'baseAmountCents', (v_own_price->>'baseAmountCents')::integer,
    'discountCents', (v_own_price->>'discountCents')::integer,
    'pricingDetails', v_own_price,
    'paymentStatus', v_own_status,
    'partnerAmountCents', v_partner_amount,
    'partnerPaymentStatus', v_partner_status,
    'partnerDiscountCents', nullif(v_partner_price->>'discountCents', '')::integer,
    'partnerPricingDetails', v_partner_price
  );
END;
$$;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric)
  TO authenticated;

CREATE FUNCTION public.register_tournament_participant_admin(
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
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND event_type = 'tournament';
  IF NOT FOUND OR v_event.social_doubles_ladder_id IS NOT NULL THEN
    RAISE EXCEPTION 'This admin registration path is only available for standalone tournaments';
  END IF;
  IF v_event.tournament_format = 'team' THEN
    IF p_category <> 'team' THEN RAISE EXCEPTION 'Team tournament participants use the team category'; END IF;
  ELSIF p_category NOT IN ('mixed', 'men', 'women') OR NOT (
    coalesce(v_event.tournament_config->'categories', '["mixed","men","women"]'::jsonb) ? p_category
  ) THEN
    RAISE EXCEPTION 'This tournament category is not enabled';
  END IF;
  IF v_user_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id AND account_kind = 'member'
      AND application_status = 'approved';
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an approved member'; END IF;
    v_name := coalesce(nullif(v_profile.full_name, ''), v_profile.email);
    v_email := v_profile.email;
    v_phone := v_profile.phone;
    v_gender := v_profile.gender;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_user_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
      AND user_id = v_user_id AND category = p_category AND status IN ('registered', 'provisional')) THEN
      RAISE EXCEPTION 'This player is already registered in this category';
    END IF;
    IF v_event.tournament_format = 'team' AND EXISTS (
      SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND status IN ('registered', 'provisional')
    ) THEN
      RAISE EXCEPTION 'This player is already registered for this team tournament';
    END IF;
    IF v_event.tournament_format = 'doubles' AND (
      SELECT count(*) FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND status IN ('registered', 'provisional')
    ) >= 2 THEN
      RAISE EXCEPTION 'A player may enter no more than two doubles categories';
    END IF;
    IF (p_category = 'men' AND v_gender = 'female') OR (p_category = 'women' AND v_gender = 'male') THEN
      RAISE EXCEPTION 'The profile gender is not eligible for this doubles category';
    END IF;
    IF (p_category = 'men' AND EXISTS (
      SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND category = 'women' AND status IN ('registered', 'provisional')
    )) OR (p_category = 'women' AND EXISTS (
      SELECT 1 FROM public.tournament_participants WHERE event_id = p_event_id
        AND user_id = v_user_id AND category = 'men' AND status IN ('registered', 'provisional')
    )) THEN
      RAISE EXCEPTION 'A player cannot enter both men''s and women''s doubles';
    END IF;
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

DROP FUNCTION public.event_tournament_my_entries(uuid);
CREATE FUNCTION public.event_tournament_my_entries(p_event_id uuid)
RETURNS TABLE(
  id uuid, team_id uuid, category text, display_name text, email text, phone text, gender text,
  tennis_skill_level numeric, payment_status text, amount_cents integer, base_amount_cents integer,
  discount_cents integer, pricing_details jsonb, confirmation_status text, partner_id uuid,
  partner_name text, partner_email text, partner_phone text, partner_gender text,
  partner_skill_level numeric, partner_confirmation_status text, partner_amount_cents integer,
  partner_discount_cents integer, partner_pricing_details jsonb, partner_is_league_team boolean,
  captain_requested boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT own.id, own.team_id, own.category, own.display_name, own.email, own.phone,
    coalesce(own.gender_override, own.gender), own.tennis_skill_level, own.payment_status,
    own.amount_cents, own.base_amount_cents, own.discount_cents, own.pricing_details,
    own.confirmation_status, partner.id, partner.display_name, partner.email, partner.phone,
    coalesce(partner.gender_override, partner.gender), partner.tennis_skill_level,
    partner.confirmation_status, partner.amount_cents, partner.discount_cents,
    partner.pricing_details, (pair.league_team_id IS NOT NULL), own.captain_requested
  FROM public.tournament_participants own
  LEFT JOIN public.tournament_pairs pair ON pair.event_id = own.event_id AND pair.status = 'active'
    AND own.id IN (pair.player_one_id, pair.player_two_id)
  LEFT JOIN public.tournament_participants partner ON partner.id =
    CASE WHEN pair.player_one_id = own.id THEN pair.player_two_id ELSE pair.player_one_id END
  WHERE own.event_id = p_event_id AND own.user_id = auth.uid()
    AND own.status IN ('registered', 'provisional')
  ORDER BY own.created_at, own.category;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_my_entries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_my_entries(uuid) TO authenticated;
