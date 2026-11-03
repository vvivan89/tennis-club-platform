-- Let an approved member without an established League team register for a later event alone.
BEGIN;

CREATE OR REPLACE FUNCTION public.register_league_single_event_entry(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament';
  IF NOT FOUND OR v_event.social_doubles_ladder_id IS NULL THEN RAISE EXCEPTION 'League event was not found'; END IF;
  SELECT * INTO v_league FROM public.social_doubles_ladders
    WHERE id=v_event.social_doubles_ladder_id AND competition_type='league';
  IF NOT FOUND OR v_event.tournament_format<>'doubles' THEN RAISE EXCEPTION 'This is not a League doubles event'; END IF;
  IF v_event.status<>'published' OR now()<v_event.registration_opens_at
     OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at)
     OR now()>=v_event.starts_at THEN RAISE EXCEPTION 'League event registration is closed'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user AND application_status='approved';
  IF NOT FOUND OR NOT public.has_active_paid_membership(v_user) THEN
    RAISE EXCEPTION 'An approved profile and active paid membership are required for League registration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_teams team WHERE team.league_id=v_league.id
       AND team.status='active' AND v_user IN (team.player_one_id,team.player_two_id)) THEN
    RAISE EXCEPTION 'You have a confirmed League partner. Register your team instead';
  END IF;
  v_category := CASE WHEN v_league.gender='male' THEN 'men' ELSE 'women' END;
  IF v_profile.gender IS NOT NULL AND v_profile.gender<>(CASE WHEN v_category='men' THEN 'male' ELSE 'female' END) THEN
    RAISE EXCEPTION 'Your profile gender does not match this League category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.event_id=p_event_id
       AND p.user_id=v_user AND p.category=v_category AND p.status='registered') THEN
    RAISE EXCEPTION 'You are already registered for this League event';
  END IF;
  IF (SELECT count(*) FROM public.tournament_participants p
      WHERE p.event_id=p_event_id AND p.status='registered')+1>v_event.capacity THEN
    RAISE EXCEPTION 'League event registration is full';
  END IF;
  v_amount := greatest(coalesce(v_event.price_cents,0),0);
  INSERT INTO public.tournament_participants(
    event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status
  ) VALUES (
    p_event_id,v_user,v_category,coalesce(nullif(v_profile.full_name,''),v_profile.email),
    v_profile.email,v_profile.phone,v_profile.gender,v_amount,
    CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END
  ) RETURNING id,amount_cents,payment_status
    INTO v_participant_id,v_amount,v_payment_status;
  RETURN jsonb_build_object('participantId',v_participant_id,'amountCents',v_amount,
    'paymentStatus',v_payment_status,'singleRegistration',true);
END; $$;

REVOKE ALL ON FUNCTION public.register_league_single_event_entry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_league_single_event_entry(uuid) TO authenticated;

COMMIT;
