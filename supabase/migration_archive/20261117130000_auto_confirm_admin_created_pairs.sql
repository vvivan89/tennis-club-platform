-- Manager-assigned pairs are confirmed by the manager's action; player-created pairs
-- continue to use the existing partner-confirmation flow.
CREATE OR REPLACE FUNCTION public.admin_create_tournament_pair(
  p_event_id uuid, p_category text, p_one uuid, p_two uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pair uuid;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events event WHERE event.id = p_event_id
      AND (public.is_admin() OR event.created_by = auth.uid() OR event.organizer_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Event manager access required';
  END IF;
  IF p_one = p_two OR NOT EXISTS (
    SELECT 1 FROM public.tournament_participants participant
    WHERE participant.id = p_one AND participant.event_id = p_event_id
      AND participant.category = p_category AND participant.status = 'registered'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.tournament_participants participant
    WHERE participant.id = p_two AND participant.event_id = p_event_id
      AND participant.category = p_category AND participant.status = 'registered'
  ) THEN
    RAISE EXCEPTION 'Select two registered participants in the same category';
  END IF;

  INSERT INTO public.tournament_pairs(event_id, category, player_one_id, player_two_id)
  VALUES (p_event_id, p_category, p_one, p_two)
  RETURNING id INTO v_pair;

  UPDATE public.tournament_participants
  SET confirmation_status = 'confirmed', confirmed_at = now(), updated_at = now()
  WHERE id IN (p_one, p_two) AND event_id = p_event_id;
  RETURN v_pair;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_tournament_pair(uuid, text, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_tournament_pair(uuid, text, uuid, uuid)
  TO authenticated;

-- Also confirm existing active pairs that audit logs identify as manager-created.
WITH manager_created_pairs AS (
  SELECT DISTINCT audit.event_id, audit.entity_id AS pair_id,
    (audit.after_data->>'player_one_id')::uuid AS player_one_id,
    (audit.after_data->>'player_two_id')::uuid AS player_two_id
  FROM public.tournament_audit_log audit
  JOIN public.profiles actor ON actor.id = audit.actor_user_id
  JOIN public.tournament_pairs pair ON pair.id = audit.entity_id
    AND pair.event_id = audit.event_id AND pair.status = 'active'
  WHERE audit.action = 'insert' AND audit.entity_type = 'tournament_pairs'
    AND actor.role IN ('admin', 'organizer')
    AND audit.after_data ? 'player_one_id' AND audit.after_data ? 'player_two_id'
)
UPDATE public.tournament_participants participant
SET confirmation_status = 'confirmed', confirmed_at = coalesce(participant.confirmed_at, now()),
    updated_at = now()
FROM manager_created_pairs pair
WHERE participant.event_id = pair.event_id
  AND participant.id IN (pair.player_one_id, pair.player_two_id)
  AND participant.status = 'registered'
  AND participant.confirmation_status = 'pending';
