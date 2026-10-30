-- Allow a single authenticated participant to pay for one or two tournament entries.
ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_tournament_participant_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; v_count integer;
BEGIN
  IF public.is_event_manager() THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text)::bigint);
  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  IF NOT FOUND OR v_event.event_type <> 'tournament' OR v_event.status <> 'published' OR now() < v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at) OR now() >= v_event.starts_at THEN
    RAISE EXCEPTION 'Tournament registration is closed';
  END IF;
  IF auth.uid() IS NULL THEN
    IF NOT v_event.allow_non_member_registration OR NEW.user_id IS NOT NULL THEN RAISE EXCEPTION 'Non-member registration is not enabled'; END IF;
  ELSE
    IF NEW.user_id = auth.uid() THEN
      IF v_event.members_only AND NOT public.current_user_has_active_paid_membership() THEN RAISE EXCEPTION 'An active paid membership is required for this tournament'; END IF;
    ELSIF NEW.user_id IS NULL AND NOT v_event.allow_non_member_registration THEN
      RAISE EXCEPTION 'Non-member registration is not enabled';
    END IF;
  END IF;
  SELECT count(*) INTO v_count FROM public.tournament_participants WHERE event_id = NEW.event_id AND status = 'registered';
  IF v_count >= v_event.capacity THEN RAISE EXCEPTION 'Tournament registration is full'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_tournament_participant_registration ON public.tournament_participants;
CREATE TRIGGER guard_tournament_participant_registration BEFORE INSERT ON public.tournament_participants FOR EACH ROW EXECUTE FUNCTION public.guard_tournament_participant_registration();

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_purpose_check
  CHECK (purpose IN ('membership', 'event_registration', 'tournament_registration', 'other'));


CREATE OR REPLACE FUNCTION public.audit_tournament_match_player_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_match_id uuid; v_event_id uuid; v_actor uuid := auth.uid(); v_before jsonb; v_after jsonb; v_participant uuid;
BEGIN
  v_match_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END;
  v_participant := CASE WHEN TG_OP = 'DELETE' THEN OLD.participant_id ELSE NEW.participant_id END;
  SELECT event_id INTO v_event_id FROM public.tournament_matches WHERE id = v_match_id;
  IF v_event_id IS NULL AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'Tournament match was not found for pairing audit'; END IF;
  IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_after := to_jsonb(NEW); END IF;
  INSERT INTO public.tournament_audit_log(event_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(v_event_id,v_actor,lower(TG_OP),'tournament_match_players',v_participant,v_before,v_after);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_tournament_match_players ON public.tournament_match_players;
CREATE TRIGGER audit_tournament_match_players AFTER INSERT OR UPDATE OR DELETE ON public.tournament_match_players FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_match_player_change();


-- Published competition details are public when enabled; when disabled, registered tournament members can still see competition information.
CREATE OR REPLACE VIEW public.tournament_public_teams AS
SELECT t.id, t.event_id, t.name, t.logo_url, t.color, t.group_number, t.captain_user_id, p.full_name AS captain_name
FROM public.tournament_teams t
LEFT JOIN public.profiles p ON p.id=t.captain_user_id
JOIN public.events e ON e.id=t.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered')));

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name, p.gender, p.status
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND p.status='registered' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered')));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id
JOIN public.tournament_participants b ON b.id=p.player_two_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered')));

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
JOIN public.events e ON e.id=m.event_id AND e.status='published'
LEFT JOIN public.tournament_teams p1 ON p1.id=m.team_one_id
LEFT JOIN public.tournament_teams p2 ON p2.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs a ON a.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs b ON b.id=m.pair_two_id
LEFT JOIN LATERAL (SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id WHERE mp.match_id=m.id AND mp.side=1) side_one ON true
LEFT JOIN LATERAL (SELECT string_agg(p.display_name, ' + ' ORDER BY p.display_name) AS players FROM public.tournament_match_players mp JOIN public.tournament_participants p ON p.id=mp.participant_id WHERE mp.match_id=m.id AND mp.side=2) side_two ON true
WHERE e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'));

DROP POLICY IF EXISTS "Public read published tournament match players" ON public.tournament_match_players;
CREATE POLICY "Public read published tournament match players" ON public.tournament_match_players FOR SELECT TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM public.tournament_matches m JOIN public.events e ON e.id=m.event_id WHERE m.id=match_id AND e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'))))
);

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
    IF NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.id = ANY(v_ids) AND p.user_id = v_payment.user_id) THEN RAISE EXCEPTION 'The payer must be one of the tournament participants'; END IF;
    IF (SELECT count(DISTINCT p.event_id) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> 1 OR (SELECT count(*) FROM public.tournament_participants p WHERE p.id = ANY(v_ids)) <> array_length(v_ids, 1) THEN RAISE EXCEPTION 'Tournament entries must exist and belong to the same event'; END IF;
    UPDATE public.tournament_participants p SET payment_status = 'paid', payment_id = v_payment.id, updated_at = now()
    WHERE p.id = ANY(v_ids) AND p.status = 'registered' AND p.payment_status IN ('pending','failed') AND p.amount_cents > 0;
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
