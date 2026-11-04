ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS allow_plus_one boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_price_cents integer NOT NULL DEFAULT 0
    CHECK (guest_price_cents >= 0);

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS guest_count smallint NOT NULL DEFAULT 0
    CHECK (guest_count IN (0, 1));

DO $$
DECLARE
  existing_check text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid)
  INTO existing_check
  FROM pg_constraint
  WHERE conname = 'events_event_type_check'
    AND conrelid = 'public.events'::regclass
    AND contype = 'c';

  IF existing_check IS NULL THEN
    RAISE EXCEPTION 'Could not find events_event_type_check on public.events';
  END IF;

  ALTER TABLE public.events DROP CONSTRAINT events_event_type_check;
  EXECUTE format(
    'ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK ((%s) OR event_type = %L)',
    existing_check,
    'party'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_approved_club_member()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'
  );
$$;
REVOKE ALL ON FUNCTION public.is_approved_club_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_club_member() TO anon, authenticated;

DROP POLICY IF EXISTS "Public published and cancelled events visible" ON public.events;
CREATE POLICY "Public published and cancelled events visible" ON public.events
  FOR SELECT TO anon, authenticated
  USING (
    CASE WHEN event_type = 'party'
      THEN status IN ('published', 'cancelled') AND public.is_approved_club_member()
      ELSE status IN ('published', 'cancelled') OR public.is_event_manager()
    END
  );

DROP POLICY IF EXISTS "Event managers manage events" ON public.events;
CREATE POLICY "Event managers manage events" ON public.events
  FOR ALL TO authenticated
  USING (
    public.is_event_manager()
    AND (event_type <> 'party' OR public.is_approved_club_member())
  )
  WITH CHECK (
    public.is_event_manager()
    AND (event_type <> 'party' OR public.is_approved_club_member())
  );

CREATE OR REPLACE VIEW public.event_public_counts AS
SELECT e.id AS event_id,
  COALESCE(sum(1 + COALESCE(r.guest_count, 0)) FILTER (WHERE r.status = 'confirmed'), 0)::integer AS confirmed_count
FROM public.events e
LEFT JOIN public.registrations r ON r.event_id = e.id
WHERE (e.status IN ('published', 'cancelled') OR public.is_event_manager())
  AND (e.event_type <> 'party' OR public.is_approved_club_member())
GROUP BY e.id;
GRANT SELECT ON public.event_public_counts TO anon, authenticated;

CREATE OR REPLACE VIEW public.event_roster AS
SELECT
  r.id AS registration_id,
  r.event_id,
  r.user_id,
  r.status,
  r.queue_position,
  r.created_at AS registered_at,
  p.full_name,
  p.avatar_url,
  p.tennis_skill_level,
  r.payment_status,
  (COALESCE(p.show_birthday_emoji, false)
    AND p.date_of_birth IS NOT NULL
    AND to_char(p.date_of_birth, 'MM-DD') = to_char((now() AT TIME ZONE 'America/Vancouver')::date, 'MM-DD'))
    AS birthday_emoji_visible,
  r.guest_count
FROM public.registrations r
JOIN public.profiles p ON p.id = r.user_id
JOIN public.events e ON e.id = r.event_id
WHERE (e.status = 'published' OR public.is_event_manager())
  AND (e.event_type <> 'party' OR public.is_approved_club_member())
  AND r.status IN ('confirmed', 'waitlisted')
  AND (
    public.is_event_manager()
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles me
        WHERE me.id = (SELECT auth.uid()) AND me.application_status = 'approved'
      )
      AND EXISTS (
        SELECT 1 FROM public.registrations own
        WHERE own.event_id = e.id AND own.user_id = (SELECT auth.uid())
          AND own.status IN ('confirmed', 'waitlisted')
      )
      AND (e.event_type = 'party' OR public.current_user_has_active_paid_membership())
    )
  );
GRANT SELECT ON public.event_roster TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_public_organizer_contacts(p_event_id uuid)
RETURNS TABLE(organizer_id uuid, organizer_name text, "position" text, emails text[], phones text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, COALESCE(NULLIF(p.full_name, ''), 'Event organizer'),
    COALESCE(cc.position, CASE WHEN p.role = 'organizer' THEN 'Event organizer' ELSE 'Club administrator' END),
    ARRAY[]::text[], ARRAY[]::text[]
  FROM public.events e
  JOIN public.profiles p ON p.id = COALESCE(e.organizer_id, e.created_by)
  LEFT JOIN public.club_contacts cc ON cc.profile_id = p.id
  WHERE e.id = p_event_id AND e.status IN ('published', 'cancelled')
    AND (e.event_type <> 'party' OR public.is_approved_club_member());
$$;
REVOKE ALL ON FUNCTION public.event_public_organizer_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_public_organizer_contacts(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_for_party_event(
  p_event_id uuid,
  p_with_guest boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_status public.registration_status := 'confirmed';
  v_amount integer;
  v_seats integer;
  v_id uuid;
  v_profile public.profiles%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  SELECT * INTO v_profile FROM public.profiles p
    WHERE p.id = v_user AND p.application_status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Your registration is pending administrator approval.'; END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.event_type <> 'party' OR v_event.status <> 'published' THEN
    RAISE EXCEPTION 'Party registration is unavailable';
  END IF;
  IF v_event.starts_at <= now() THEN RAISE EXCEPTION 'Registration is unavailable for events that have already started'; END IF;
  IF now() < v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN
    RAISE EXCEPTION 'Registration is closed';
  END IF;
  IF p_with_guest AND NOT v_event.allow_plus_one THEN RAISE EXCEPTION 'This Party does not allow a +1'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_suspensions s
    WHERE s.user_id = v_user
      AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on
      AND s.cancelled_at IS NULL
  ) THEN RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.registrations r
    WHERE r.event_id = p_event_id AND r.user_id = v_user AND r.status <> 'cancelled'
  ) THEN RAISE EXCEPTION 'You are already registered'; END IF;

  SELECT COALESCE(sum(1 + COALESCE(r.guest_count, 0)), 0)::integer INTO v_seats
  FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'confirmed';
  IF v_seats + 1 + (CASE WHEN p_with_guest THEN 1 ELSE 0 END) > v_event.capacity THEN
    RAISE EXCEPTION 'This Party is full';
  END IF;

  v_amount := COALESCE(v_event.price_cents, 0)
    + CASE WHEN p_with_guest THEN COALESCE(v_event.guest_price_cents, 0) ELSE 0 END;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  INSERT INTO public.registrations(event_id, user_id, status, amount_cents, payment_status, guest_count)
  VALUES (p_event_id, v_user, v_status, v_amount,
    CASE WHEN v_amount = 0 THEN 'not_required' ELSE 'pending' END,
    CASE WHEN p_with_guest THEN 1 ELSE 0 END)
  RETURNING id INTO v_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);

  PERFORM public.record_business_audit_event(
    'event.registration.created',
    'Added ' || COALESCE(v_profile.full_name, 'a player') || ' to ' || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'added', 'player_id', v_user,
      'player_name', COALESCE(v_profile.full_name, 'Player ' || v_user::text),
      'registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', NULL, 'new_status', v_status, 'guest_count', CASE WHEN p_with_guest THEN 1 ELSE 0 END
    )), 'operation', 'added'),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id,
      'event_name', v_event.title, 'player_id', v_user,
      'player_name', COALESCE(v_profile.full_name, 'Player ' || v_user::text),
      'new_status', v_status, 'guest_count', CASE WHEN p_with_guest THEN 1 ELSE 0 END),
    NULL, 'rpc', p_idempotency_key
  );
  RETURN QUERY SELECT v_id, v_status, NULL::bigint;
END;
$$;
REVOKE ALL ON FUNCTION public.register_for_party_event(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_party_event(uuid, boolean, text) TO authenticated;

-- Party registrations charge the snapshotted combined amount stored on the registration.
DO $$
DECLARE
  definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.fulfill_successful_payment(uuid)'::regprocedure) INTO definition;
  updated_definition := replace(
    definition,
    'AND r.amount_cents = v_payment.amount_minor AND e.price_cents = v_payment.amount_minor',
    'AND r.amount_cents = v_payment.amount_minor AND (e.event_type = ''party'' OR e.price_cents = v_payment.amount_minor)'
  );
  IF updated_definition = definition THEN
    RAISE EXCEPTION 'Could not update event payment fulfillment validation';
  END IF;
  EXECUTE updated_definition;
END;
$$;
