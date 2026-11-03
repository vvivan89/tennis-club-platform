-- Tournament registration improvements: optional guest skill ratings, member partner lookup,
-- provisional guest entries, per-participant payment/withdrawal and category-safe reuse.
ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS tennis_skill_level numeric(2,1);
ALTER TABLE public.tournament_participants
  DROP CONSTRAINT IF EXISTS tournament_participants_status_check;
ALTER TABLE public.tournament_participants
  ADD CONSTRAINT tournament_participants_status_check
  CHECK (status IN ('registered','provisional','withdrawn','replaced'));
ALTER TABLE public.tournament_participants
  DROP CONSTRAINT IF EXISTS tournament_participants_tennis_skill_level_check;
ALTER TABLE public.tournament_participants
  ADD CONSTRAINT tournament_participants_tennis_skill_level_check
  CHECK (tennis_skill_level IS NULL OR (tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(tennis_skill_level - 2.5, 0.5) = 0));
CREATE UNIQUE INDEX IF NOT EXISTS tournament_participants_email_category_active_idx
  ON public.tournament_participants(event_id, lower(email), category)
  WHERE email IS NOT NULL AND status IN ('registered','provisional');

-- Keep the public views limited to completed registrations and prefer a manually entered
-- guest skill rating over the profile rating.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name,
       coalesce(p.gender_override, p.gender) AS gender, p.status,
       coalesce(p.tennis_skill_level::text, profile.tennis_skill_level) AS tennis_skill_level,
       (p.user_id IS NOT NULL) AS is_member
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own
    WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name,
       coalesce(a.tennis_skill_level::text, profile_a.tennis_skill_level) AS player_one_skill_level,
       coalesce(b.tennis_skill_level::text, profile_b.tennis_skill_level) AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id AND a.status='registered'
JOIN public.tournament_participants b ON b.id=p.player_two_id AND b.status='registered'
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own
  WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
)));

CREATE OR REPLACE FUNCTION public.event_tournament_partner_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, gender text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'
  ) THEN RAISE EXCEPTION 'An approved member account is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND e.event_type='tournament' AND e.status='published') THEN
    RAISE EXCEPTION 'Tournament is unavailable';
  END IF;
  RETURN QUERY SELECT p.id, coalesce(nullif(p.full_name,''), p.email), p.gender
  FROM public.profiles p
  WHERE p.application_status='approved' AND p.id<>auth.uid()
  ORDER BY coalesce(nullif(p.full_name,''), p.email);
END;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_partner_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_partner_directory(uuid) TO authenticated;

-- New signature supports selecting any approved member as a partner and optional skill ratings.
-- The original registration RPC remains intact for compatibility with existing callers.
CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid, p_category text, p_display_name text, p_email text, p_phone text,
 p_gender text, p_partner_participant_id uuid, p_partner_name text, p_partner_email text,
 p_partner_phone text, p_partner_gender text, p_partner_user_id uuid,
 p_tennis_skill_level numeric, p_partner_tennis_skill_level numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_partner public.profiles%rowtype;
  v_participant_id uuid;
  v_partner_participant_id uuid;
  v_pair_id uuid;
  v_status text;
BEGIN
  IF p_tennis_skill_level IS NOT NULL AND NOT (p_tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(p_tennis_skill_level - 2.5, 0.5)=0) THEN
    RAISE EXCEPTION 'Skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_partner_tennis_skill_level IS NOT NULL AND NOT (p_partner_tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(p_partner_tennis_skill_level - 2.5, 0.5)=0) THEN
    RAISE EXCEPTION 'Partner skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_partner_user_id IS NOT NULL THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to select a member partner'; END IF;
    IF p_partner_participant_id IS NOT NULL OR p_partner_name IS NOT NULL THEN RAISE EXCEPTION 'Select only one partner source'; END IF;
    SELECT * INTO v_partner FROM public.profiles WHERE id=p_partner_user_id AND application_status='approved';
    IF NOT FOUND OR p_partner_user_id=auth.uid() THEN RAISE EXCEPTION 'Select a different approved member as partner'; END IF;
    SELECT id INTO p_partner_participant_id FROM public.tournament_participants
      WHERE event_id=p_event_id AND user_id=p_partner_user_id AND category=p_category AND status='registered'
      LIMIT 1;
    IF p_partner_participant_id IS NULL THEN
      p_partner_name := coalesce(nullif(v_partner.full_name,''), v_partner.email);
      p_partner_email := v_partner.email;
      p_partner_phone := v_partner.phone;
      p_partner_gender := v_partner.gender;
    END IF;
  END IF;
  v_result := public.register_tournament_entry(
    p_event_id, p_category, p_display_name, p_email, p_phone, p_gender,
    p_partner_participant_id, p_partner_name, p_partner_email, p_partner_phone, p_partner_gender
  );
  v_participant_id := (v_result->>'participantId')::uuid;
  v_partner_participant_id := nullif(v_result->>'partnerParticipantId','')::uuid;
  v_pair_id := nullif(v_result->>'pairId','')::uuid;
  SELECT payment_status INTO v_status FROM public.tournament_participants WHERE id=v_participant_id;
  v_result := jsonb_set(v_result, '{paymentStatus}', to_jsonb(v_status), true);
  IF p_tennis_skill_level IS NOT NULL THEN
    UPDATE public.tournament_participants SET tennis_skill_level=p_tennis_skill_level WHERE id=v_participant_id;
  END IF;
  IF v_partner_participant_id IS NOT NULL THEN
    IF p_partner_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=v_partner_participant_id AND user_id IS NULL) THEN
      UPDATE public.tournament_participants SET user_id=p_partner_user_id,
        display_name=coalesce(nullif(v_partner.full_name,''),v_partner.email), email=v_partner.email,
        phone=v_partner.phone, gender=v_partner.gender
      WHERE id=v_partner_participant_id;
    END IF;
    IF p_partner_tennis_skill_level IS NOT NULL THEN
      UPDATE public.tournament_participants SET tennis_skill_level=p_partner_tennis_skill_level WHERE id=v_partner_participant_id;
    END IF;
  END IF;
  IF auth.uid() IS NULL AND coalesce((v_result->>'amountCents')::integer,0)>0 THEN
    UPDATE public.tournament_participants SET status='provisional' WHERE id=v_participant_id;
    IF v_partner_participant_id IS NOT NULL AND p_partner_participant_id IS NULL AND p_partner_name IS NOT NULL THEN
      UPDATE public.tournament_participants SET status='provisional' WHERE id=v_partner_participant_id AND user_id IS NULL;
    END IF;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) TO anon, authenticated;

-- Successful payment finalizes guest registrations. A trigger keeps this true for all
-- payment fulfillment paths (webhook, status reconciliation, and administrator recovery).
CREATE OR REPLACE FUNCTION public.finalize_paid_tournament_guest_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.payment_status='paid' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.status='provisional' THEN
    NEW.status := 'registered';
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finalize_paid_tournament_guest_entry ON public.tournament_participants;
CREATE TRIGGER finalize_paid_tournament_guest_entry
BEFORE UPDATE OF payment_status ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.finalize_paid_tournament_guest_entry();

CREATE OR REPLACE FUNCTION public.withdraw_tournament_entry(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.tournament_participants%rowtype; v_event public.events%rowtype;
BEGIN
  SELECT * INTO v_entry FROM public.tournament_participants WHERE id=p_participant_id AND user_id=auth.uid() AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered entry not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_entry.event_id;
  IF now() >= coalesce(v_event.registration_closes_at, v_event.starts_at) THEN RAISE EXCEPTION 'The withdrawal cutoff has passed'; END IF;
  UPDATE public.tournament_participants SET status='withdrawn', updated_at=now() WHERE id=v_entry.id;
  UPDATE public.tournament_pairs SET status='withdrawn' WHERE event_id=v_entry.event_id AND category=v_entry.category
    AND (player_one_id=v_entry.id OR player_two_id=v_entry.id) AND status='active';
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_tournament_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_tournament_entry(uuid) TO authenticated;

-- Reuse is limited to a previously paid, never-refunded entry for the same event and category.
CREATE OR REPLACE FUNCTION public.reuse_prior_tournament_entry_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prior public.payments%rowtype;
BEGIN
  IF NEW.status <> 'registered' OR NEW.amount_cents <= 0 OR NEW.user_id IS NULL OR NEW.payment_status NOT IN ('pending','failed') THEN RETURN NEW; END IF;
  SELECT pay.* INTO v_prior FROM public.payments pay
  JOIN public.tournament_participants old_entry ON old_entry.id::text=ANY(string_to_array(pay.business_record_id, ','))
  WHERE pay.purpose='tournament_registration' AND pay.status='succeeded'
    AND coalesce(pay.refunded_amount_minor,0)=0 AND old_entry.payment_id=pay.id
    AND old_entry.amount_cents=NEW.amount_cents
    AND old_entry.event_id=NEW.event_id AND old_entry.category=NEW.category
    AND old_entry.status='withdrawn' AND old_entry.user_id=NEW.user_id
  ORDER BY pay.succeeded_at DESC NULLS LAST, pay.created_at DESC LIMIT 1;
  IF v_prior.id IS NOT NULL THEN
    NEW.payment_status := 'paid';
    NEW.payment_id := v_prior.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reuse_prior_tournament_entry_payment ON public.tournament_participants;
CREATE TRIGGER reuse_prior_tournament_entry_payment BEFORE INSERT OR UPDATE ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.reuse_prior_tournament_entry_payment();


-- Guest Stripe payments can fulfill only non-member tournament entries.
CREATE OR REPLACE FUNCTION public.fulfill_successful_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_registration_id uuid;
  v_family_id uuid;
  v_updated integer;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF v_payment.status <> 'succeeded' THEN RAISE EXCEPTION 'Only succeeded payments can be fulfilled'; END IF;

  IF v_payment.purpose = 'membership' THEN
    IF v_payment.business_record_id LIKE 'family:%' THEN
      IF substring(v_payment.business_record_id FROM 8) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid family reference on payment'; END IF;
      v_family_id := substring(v_payment.business_record_id FROM 8)::uuid;
      UPDATE public.membership_families SET paid_at = COALESCE(paid_at, now()), paid_by = COALESCE(paid_by, v_payment.user_id), payment_id = COALESCE(payment_id, v_payment.id) WHERE id = v_family_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    ELSIF v_payment.business_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_membership_id := v_payment.business_record_id::uuid;
      UPDATE public.memberships SET status = 'active', payment_status = 'paid', updated_at = now() WHERE id = v_membership_id AND user_id = v_payment.user_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    END IF;
    RAISE EXCEPTION 'Membership or family record was not found for payment';
  ELSIF v_payment.purpose = 'event_registration' THEN
    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid registration reference on payment'; END IF;
    v_registration_id := v_payment.business_record_id::uuid;
    UPDATE public.registrations r SET payment_status = 'paid', payment_provider = 'stripe', provider_reference = COALESCE(v_payment.stripe_payment_intent_id, v_payment.stripe_checkout_session_id), updated_at = now()
    FROM public.events e WHERE r.id = v_registration_id AND r.event_id = e.id AND r.user_id = v_payment.user_id AND r.status = 'confirmed' AND r.amount_cents = v_payment.amount_minor AND e.price_cents = v_payment.amount_minor AND r.payment_status IN ('pending', 'failed', 'paid');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.registrations WHERE id = v_registration_id AND user_id = v_payment.user_id AND payment_status = 'paid') THEN RETURN; END IF;
    RAISE EXCEPTION 'Confirmed registration does not match the successful payment';
  ELSIF v_payment.purpose = 'tournament_registration' THEN
    IF coalesce(array_length(string_to_array(v_payment.business_record_id, ','), 1), 0) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'Invalid tournament entry reference on payment'; END IF;
    BEGIN v_ids := string_to_array(v_payment.business_record_id, ',')::uuid[]; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid tournament participant reference'; END;
    IF v_payment.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND p.user_id = v_payment.user_id) AND NOT EXISTS (
      SELECT 1 FROM public.tournament_pairs pair
      JOIN public.tournament_participants payer ON payer.id IN (pair.player_one_id,pair.player_two_id)
      JOIN public.tournament_participants target ON target.id IN (pair.player_one_id,pair.player_two_id) AND target.id <> payer.id
      WHERE pair.event_id=(SELECT event_id FROM public.tournament_participants WHERE id=ANY(v_ids) LIMIT 1)
        AND pair.status='active' AND payer.user_id=v_payment.user_id AND target.id=ANY(v_ids)
    ) THEN RAISE EXCEPTION 'The payer must be one of the tournament participants or their registered partner'; END IF;
    IF v_payment.user_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND p.user_id IS NULL AND p.status IN ('provisional','registered')) AND NOT EXISTS (
      SELECT 1 FROM public.tournament_pairs pair
      JOIN public.tournament_participants guest ON guest.id IN (pair.player_one_id,pair.player_two_id)
      JOIN public.tournament_participants target ON target.id IN (pair.player_one_id,pair.player_two_id) AND target.id <> guest.id
      WHERE pair.status='active' AND target.id=ANY(v_ids) AND guest.user_id IS NULL AND guest.status='registered'
    ) THEN RAISE EXCEPTION 'Guest payments must include a non-member entry or its paired entry'; END IF;
    IF (SELECT count(DISTINCT p.event_id) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> 1 OR (SELECT count(*) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> array_length(v_ids, 1) THEN RAISE EXCEPTION 'Tournament entries must exist and belong to the same event'; END IF;
    UPDATE public.tournament_participants p SET payment_status = 'paid', payment_id = v_payment.id, updated_at = now()
    WHERE p.id = ANY(v_ids) AND p.status IN ('registered','provisional') AND p.payment_status IN ('pending','failed') AND p.amount_cents > 0;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND (p.payment_status <> 'paid' OR p.payment_id IS DISTINCT FROM v_payment.id)) THEN RAISE EXCEPTION 'Tournament entries do not match the successful payment'; END IF;
    IF (SELECT coalesce(sum(p.amount_cents), 0) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> v_payment.amount_minor THEN RAISE EXCEPTION 'Tournament entry total does not match the payment amount'; END IF;
    RETURN;
  ELSE
    RAISE EXCEPTION 'Unsupported payment purpose for fulfillment';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_successful_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_successful_payment(uuid) TO service_role;

-- Reveal only the paired payment state to a participant in that pair, so the team is
-- marked paid only when both individual entry fees have been satisfied.
CREATE OR REPLACE FUNCTION public.event_tournament_pair_payment_status(p_event_id uuid)
RETURNS TABLE(pair_id uuid, player_one_id uuid, player_two_id uuid, player_one_payment_status text, player_two_payment_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  RETURN QUERY
  SELECT pair.id, pair.player_one_id, pair.player_two_id, one.payment_status, two.payment_status
  FROM public.tournament_pairs pair
  JOIN public.tournament_participants one ON one.id=pair.player_one_id
  JOIN public.tournament_participants two ON two.id=pair.player_two_id
  WHERE pair.event_id=p_event_id AND pair.status='active'
    AND one.status='registered' AND two.status='registered'
    AND (one.user_id=auth.uid() OR two.user_id=auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_pair_payment_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_pair_payment_status(uuid) TO authenticated;

-- Publicly published events expose organizer identity/role, but not private contact details.
CREATE OR REPLACE FUNCTION public.event_public_organizer_contacts(p_event_id uuid)
RETURNS TABLE(organizer_id uuid, organizer_name text, "position" text, emails text[], phones text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, coalesce(nullif(p.full_name,''), 'Event organizer'),
         coalesce(cc.position, CASE WHEN p.role='organizer' THEN 'Event organizer' ELSE 'Club administrator' END),
         ARRAY[]::text[], ARRAY[]::text[]
  FROM public.events e
  JOIN public.profiles p ON p.id=coalesce(e.organizer_id,e.created_by)
  LEFT JOIN public.club_contacts cc ON cc.profile_id=p.id
  WHERE e.id=p_event_id AND e.status IN ('published','cancelled');
$$;
REVOKE ALL ON FUNCTION public.event_public_organizer_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_public_organizer_contacts(uuid) TO anon, authenticated;


-- Preserve category checks for known genders, but treat unspecified/legacy non-binary values as unknown.
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
 IF p_category='men' AND v_gender IS NOT NULL AND v_gender<>'male' THEN RAISE EXCEPTION 'The entered gender is not eligible for men''s doubles'; END IF;
 IF p_category='women' AND v_gender IS NOT NULL AND v_gender<>'female' THEN RAISE EXCEPTION 'The entered gender is not eligible for women''s doubles'; END IF;

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
   IF p_category='men' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'male' THEN RAISE EXCEPTION 'The partner gender is not eligible for men''s doubles'; END IF;
   IF p_category='women' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'female' THEN RAISE EXCEPTION 'The partner gender is not eligible for women''s doubles'; END IF;

   IF p_category='mixed' AND v_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_gender=p_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
   INSERT INTO public.tournament_participants(event_id,category,display_name,email,phone,gender,amount_cents,payment_status)
   VALUES(p_event_id,p_category,btrim(p_partner_name),lower(btrim(p_partner_email)),nullif(btrim(p_partner_phone),''),p_partner_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
   RETURNING id INTO v_partner_id;
 ELSE
   v_partner_id := NULL;
 END IF;

 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_gender IN ('male','female') AND v_partner_gender IN ('male','female') AND v_gender=v_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='men' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'male' THEN RAISE EXCEPTION 'The selected partner is not eligible for men''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='women' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'female' THEN RAISE EXCEPTION 'The selected partner is not eligible for women''s doubles'; END IF;

 IF v_partner_id IS NOT NULL THEN
   INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
   VALUES(p_event_id,p_category,v_participant_id,v_partner_id) RETURNING id INTO v_pair_id;
 END IF;
 RETURN jsonb_build_object('participantId',v_participant_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END);
END;
$$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO anon, authenticated;
