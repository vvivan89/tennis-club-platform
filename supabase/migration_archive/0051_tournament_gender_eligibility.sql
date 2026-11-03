-- Enforce category eligibility whenever a participant has a known gender. An unset gender remains eligible for any enabled category.
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
 IF p_category='mixed' AND v_gender IS NOT NULL AND v_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The entered gender is not eligible for mixed doubles'; END IF;
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
   IF p_category='mixed' AND p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The partner gender is not eligible for mixed doubles'; END IF;
   IF p_category='mixed' AND v_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_gender=p_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
   INSERT INTO public.tournament_participants(event_id,category,display_name,email,phone,gender,amount_cents,payment_status)
   VALUES(p_event_id,p_category,btrim(p_partner_name),lower(btrim(p_partner_email)),nullif(btrim(p_partner_phone),''),p_partner_gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
   RETURNING id INTO v_partner_id;
 ELSE
   v_partner_id := NULL;
 END IF;
 IF p_category='mixed' AND v_gender IS NOT NULL AND v_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The entered gender is not eligible for mixed doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_gender IN ('male','female') AND v_partner_gender IN ('male','female') AND v_gender=v_partner_gender THEN RAISE EXCEPTION 'Mixed doubles requires one male and one female player'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='men' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'male' THEN RAISE EXCEPTION 'The selected partner is not eligible for men''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='women' AND v_partner_gender IS NOT NULL AND v_partner_gender<>'female' THEN RAISE EXCEPTION 'The selected partner is not eligible for women''s doubles'; END IF;
 IF p_partner_participant_id IS NOT NULL AND p_category='mixed' AND v_partner_gender IS NOT NULL AND v_partner_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'The selected partner is not eligible for mixed doubles'; END IF;
 IF v_partner_id IS NOT NULL THEN
   INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
   VALUES(p_event_id,p_category,v_participant_id,v_partner_id) RETURNING id INTO v_pair_id;
 END IF;
 RETURN jsonb_build_object('participantId',v_participant_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END);
END;
$$;

REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO anon, authenticated;
