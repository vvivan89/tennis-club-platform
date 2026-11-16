-- Keep dates of birth and guardian contacts out of public-facing profile and
-- tournament participant records while collecting them for under-18 players.
CREATE TABLE public.player_private_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_id uuid UNIQUE REFERENCES public.tournament_participants(id) ON DELETE CASCADE,
  date_of_birth date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((profile_id IS NULL) <> (participant_id IS NULL))
);

CREATE TABLE public.player_legal_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  private_details_id uuid NOT NULL REFERENCES public.player_private_details(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR length(email) <= 254),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (nullif(btrim(coalesce(email, '')), '') IS NOT NULL OR nullif(btrim(coalesce(phone, '')), '') IS NOT NULL)
);

CREATE INDEX player_legal_guardians_private_details_idx
  ON public.player_legal_guardians(private_details_id);

ALTER TABLE public.player_private_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_legal_guardians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players and admins read private player details"
ON public.player_private_details FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR profile_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tournament_participants participant
    WHERE participant.id = participant_id
      AND (participant.user_id = (SELECT auth.uid())
        OR lower(participant.email) = lower((SELECT auth.jwt()->>'email')))
  )
);

CREATE POLICY "Players and admins read legal guardians"
ON public.player_legal_guardians FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.player_private_details details
    WHERE details.id = private_details_id
      AND (
        details.profile_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.tournament_participants participant
          WHERE participant.id = details.participant_id
            AND (participant.user_id = (SELECT auth.uid())
              OR lower(participant.email) = lower((SELECT auth.jwt()->>'email')))
        )
      )
  )
);

GRANT SELECT ON public.player_private_details, public.player_legal_guardians TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_player_guardians(
  p_date_of_birth date,
  p_guardians jsonb
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_guardian jsonb;
  v_valid_count integer := 0;
  v_count integer := 0;
  v_today date := (now() AT TIME ZONE 'America/Vancouver')::date;
BEGIN
  IF p_date_of_birth IS NULL OR p_date_of_birth > v_today THEN
    RAISE EXCEPTION 'Enter a valid date of birth.';
  END IF;
  IF p_guardians IS NULL OR jsonb_typeof(p_guardians) <> 'array' THEN
    RAISE EXCEPTION 'Guardian details must be a list.';
  END IF;
  IF extract(year FROM age(v_today, p_date_of_birth)) >= 18 THEN
    RETURN;
  END IF;
  FOR v_guardian IN SELECT value FROM jsonb_array_elements(p_guardians)
  LOOP
    v_count := v_count + 1;
    IF length(btrim(coalesce(v_guardian->>'name', ''))) > 0
      AND (length(btrim(coalesce(v_guardian->>'email', ''))) > 0
        OR length(btrim(coalesce(v_guardian->>'phone', ''))) > 0)
      AND length(coalesce(v_guardian->>'name', '')) <= 120
      AND length(coalesce(v_guardian->>'email', '')) <= 254
      AND length(coalesce(v_guardian->>'phone', '')) <= 40
      AND (length(btrim(coalesce(v_guardian->>'email', ''))) = 0
        OR v_guardian->>'email' ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
      v_valid_count := v_valid_count + 1;
    ELSE
      RAISE EXCEPTION 'Each parent or legal guardian needs a name and at least one contact method.';
    END IF;
  END LOOP;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'For a player under 18, add at least one parent or legal guardian.';
  END IF;
  IF v_valid_count = 0 THEN
    RAISE EXCEPTION 'For a player under 18, add at least one parent or legal guardian with a name and contact.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_player_private_details(
  p_profile_id uuid,
  p_participant_id uuid,
  p_date_of_birth date,
  p_guardians jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_details_id uuid;
  v_guardian jsonb;
  v_guardians jsonb := coalesce(p_guardians, '[]'::jsonb);
BEGIN
  IF (p_profile_id IS NULL) = (p_participant_id IS NULL) THEN
    RAISE EXCEPTION 'Private player details require exactly one player record.';
  END IF;
  PERFORM public.validate_player_guardians(p_date_of_birth, v_guardians);
  IF p_profile_id IS NOT NULL THEN
    INSERT INTO public.player_private_details(profile_id, date_of_birth)
    VALUES (p_profile_id, p_date_of_birth)
    ON CONFLICT (profile_id) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth
    RETURNING id INTO v_details_id;
  ELSE
    INSERT INTO public.player_private_details(participant_id, date_of_birth)
    VALUES (p_participant_id, p_date_of_birth)
    ON CONFLICT (participant_id) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth
    RETURNING id INTO v_details_id;
  END IF;
  DELETE FROM public.player_legal_guardians WHERE private_details_id = v_details_id;
  IF extract(year FROM age((now() AT TIME ZONE 'America/Vancouver')::date, p_date_of_birth)) < 18 THEN
    FOR v_guardian IN SELECT value FROM jsonb_array_elements(v_guardians)
    LOOP
      INSERT INTO public.player_legal_guardians(private_details_id, full_name, email, phone)
      VALUES (
        v_details_id,
        btrim(v_guardian->>'name'),
        nullif(lower(btrim(v_guardian->>'email')), ''),
        nullif(btrim(v_guardian->>'phone'), '')
      );
    END LOOP;
  END IF;
  RETURN v_details_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.copy_or_store_participant_private_details(
  p_participant_id uuid,
  p_profile_id uuid,
  p_fallback_date_of_birth date,
  p_fallback_guardians jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_date_of_birth date;
  v_guardians jsonb;
BEGIN
  IF p_profile_id IS NOT NULL THEN
    SELECT details.date_of_birth,
      coalesce(jsonb_agg(jsonb_build_object(
        'name', guardian.full_name, 'email', guardian.email, 'phone', guardian.phone
      )) FILTER (WHERE guardian.id IS NOT NULL), '[]'::jsonb)
    INTO v_date_of_birth, v_guardians
    FROM public.player_private_details details
    LEFT JOIN public.player_legal_guardians guardian ON guardian.private_details_id = details.id
    WHERE details.profile_id = p_profile_id
    GROUP BY details.id;
  END IF;
  PERFORM public.store_player_private_details(
    NULL,
    p_participant_id,
    coalesce(v_date_of_birth, p_fallback_date_of_birth),
    coalesce(v_guardians, p_fallback_guardians, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_new_profile_private_details()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_date_of_birth date;
BEGIN
  IF new.raw_user_meta_data->>'account_kind' = 'event_guest' THEN
    RETURN new;
  END IF;
  v_date_of_birth := nullif(new.raw_user_meta_data->>'date_of_birth', '')::date;
  PERFORM public.store_player_private_details(
    new.id,
    NULL,
    v_date_of_birth,
    coalesce(new.raw_user_meta_data->'legal_guardians', '[]'::jsonb)
  );
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS z_capture_new_profile_private_details ON auth.users;
CREATE TRIGGER z_capture_new_profile_private_details
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.capture_new_profile_private_details();

CREATE OR REPLACE FUNCTION public.register_event_guest_tournament_entry_with_guardians(
  p_event_id uuid,
  p_category text,
  p_display_name text,
  p_phone text,
  p_gender text,
  p_tennis_skill_level numeric,
  p_partner_name text DEFAULT NULL,
  p_partner_email text DEFAULT NULL,
  p_partner_phone text DEFAULT NULL,
  p_partner_gender text DEFAULT NULL,
  p_partner_skill_level numeric DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_guardians jsonb DEFAULT '[]'::jsonb,
  p_partner_date_of_birth date DEFAULT NULL,
  p_partner_guardians jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_participant_id uuid;
  v_partner_id uuid;
  v_partner_user_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.player_private_details WHERE profile_id = auth.uid()
  ) THEN
    PERFORM public.validate_player_guardians(p_date_of_birth, p_guardians);
  END IF;
  IF nullif(btrim(coalesce(p_partner_name, '')), '') IS NOT NULL
    OR nullif(btrim(coalesce(p_partner_email, '')), '') IS NOT NULL THEN
    PERFORM public.validate_player_guardians(p_partner_date_of_birth, p_partner_guardians);
  END IF;
  v_result := public.register_event_guest_tournament_entry(
    p_event_id, p_category, p_display_name, p_phone, p_gender, p_tennis_skill_level,
    p_partner_name, p_partner_email, p_partner_phone, p_partner_gender, p_partner_skill_level
  );
  v_participant_id := nullif(v_result->>'participantId', '')::uuid;
  v_partner_id := nullif(v_result->>'partnerParticipantId', '')::uuid;
  IF v_participant_id IS NOT NULL THEN
    PERFORM public.copy_or_store_participant_private_details(
      v_participant_id, auth.uid(), p_date_of_birth, p_guardians
    );
  END IF;
  IF v_partner_id IS NOT NULL THEN
    SELECT user_id INTO v_partner_user_id FROM public.tournament_participants WHERE id = v_partner_id;
    PERFORM public.copy_or_store_participant_private_details(
      v_partner_id, v_partner_user_id, p_partner_date_of_birth, p_partner_guardians
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_event_guest_tournament_singles_entry(
  p_event_id uuid,
  p_category text,
  p_display_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_tennis_skill_level numeric DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_guardians jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_participant_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.player_private_details WHERE profile_id = auth.uid()
  ) THEN
    PERFORM public.validate_player_guardians(p_date_of_birth, p_guardians);
  END IF;
  v_result := public.register_tournament_singles_entry(
    p_event_id, p_category, p_display_name, p_email, p_phone, p_gender, p_tennis_skill_level
  );
  v_participant_id := nullif(v_result->>'participantId', '')::uuid;
  IF v_participant_id IS NOT NULL THEN
    PERFORM public.copy_or_store_participant_private_details(
      v_participant_id, auth.uid(), p_date_of_birth, p_guardians
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_tournament_entry_with_guardians(
  p_event_id uuid,
  p_category text,
  p_display_name text,
  p_email text,
  p_phone text,
  p_gender text,
  p_partner_participant_id uuid,
  p_partner_name text,
  p_partner_email text,
  p_partner_phone text,
  p_partner_gender text,
  p_partner_user_id uuid,
  p_tennis_skill_level numeric,
  p_partner_tennis_skill_level numeric,
  p_partner_date_of_birth date,
  p_partner_guardians jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_partner_id uuid;
  v_partner_user_id uuid;
BEGIN
  PERFORM public.validate_player_guardians(p_partner_date_of_birth, p_partner_guardians);
  v_result := public.register_tournament_entry(
    p_event_id, p_category, p_display_name, p_email, p_phone, p_gender,
    p_partner_participant_id, p_partner_name, p_partner_email, p_partner_phone,
    p_partner_gender, p_partner_user_id, p_tennis_skill_level, p_partner_tennis_skill_level
  );
  v_partner_id := nullif(v_result->>'partnerParticipantId', '')::uuid;
  IF v_partner_id IS NOT NULL THEN
    SELECT user_id INTO v_partner_user_id FROM public.tournament_participants WHERE id = v_partner_id;
    PERFORM public.copy_or_store_participant_private_details(
      v_partner_id, v_partner_user_id, p_partner_date_of_birth, p_partner_guardians
    );
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_player_guardians(date,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_player_private_details(uuid,uuid,date,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.copy_or_store_participant_private_details(uuid,uuid,date,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_new_profile_private_details() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry_with_guardians(uuid,text,text,text,text,numeric,text,text,text,text,numeric,date,jsonb,date,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_singles_entry(uuid,text,text,text,text,text,numeric,date,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_tournament_entry_with_guardians(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric,date,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_event_guest_tournament_entry_with_guardians(uuid,text,text,text,text,numeric,text,text,text,text,numeric,date,jsonb,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_event_guest_tournament_singles_entry(uuid,text,text,text,text,text,numeric,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry_with_guardians(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric,date,jsonb) TO authenticated;
