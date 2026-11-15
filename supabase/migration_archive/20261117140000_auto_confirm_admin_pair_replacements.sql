-- Admin replacements are also final pair assignments, so keep the updated pair confirmed.
CREATE OR REPLACE FUNCTION public.admin_require_pair_confirmation(p_pair_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event uuid;
  v_one uuid;
  v_two uuid;
BEGIN
  SELECT event_id, player_one_id, player_two_id INTO v_event, v_one, v_two
  FROM public.tournament_pairs
  WHERE id = p_pair_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND OR NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events event WHERE event.id = v_event
      AND (public.is_admin() OR event.created_by = auth.uid() OR event.organizer_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Event manager access required';
  END IF;

  UPDATE public.tournament_participants
  SET confirmation_status = 'confirmed', confirmed_at = now(), updated_at = now()
  WHERE id IN (v_one, v_two) AND event_id = v_event AND status = 'registered';
  IF NOT FOUND THEN RAISE EXCEPTION 'Both pair members must have active registrations'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_require_pair_confirmation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_require_pair_confirmation(uuid) TO authenticated;

-- Backfill pending replacements made by managers. Ordinary player-created pair invitations
-- are unaffected because their audit rows are attributed to the players, not event managers.
WITH manager_replaced_pairs AS (
  SELECT DISTINCT audit.event_id, audit.entity_id AS pair_id,
    (audit.after_data->>'player_one_id')::uuid AS player_one_id,
    (audit.after_data->>'player_two_id')::uuid AS player_two_id
  FROM public.tournament_audit_log audit
  JOIN public.profiles actor ON actor.id = audit.actor_user_id
  JOIN public.tournament_pairs pair ON pair.id = audit.entity_id
    AND pair.event_id = audit.event_id AND pair.status = 'active'
  WHERE audit.action = 'update' AND audit.entity_type = 'tournament_pairs'
    AND actor.role IN ('admin', 'organizer')
    AND (
      audit.before_data->>'player_one_id' IS DISTINCT FROM audit.after_data->>'player_one_id'
      OR audit.before_data->>'player_two_id' IS DISTINCT FROM audit.after_data->>'player_two_id'
    )
)
UPDATE public.tournament_participants participant
SET confirmation_status = 'confirmed', confirmed_at = coalesce(participant.confirmed_at, now()),
    updated_at = now()
FROM manager_replaced_pairs pair
WHERE participant.event_id = pair.event_id
  AND participant.id IN (pair.player_one_id, pair.player_two_id)
  AND participant.status = 'registered'
  AND participant.confirmation_status = 'pending';
