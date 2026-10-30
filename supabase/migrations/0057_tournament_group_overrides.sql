-- Persist administrator overrides for tournament group rankings and promotion badges.
CREATE TABLE IF NOT EXISTS public.tournament_group_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL,
  group_number integer NOT NULL CHECK (group_number > 0),
  entry_id uuid NOT NULL,
  override_type text NOT NULL CHECK (override_type IN ('ranking', 'promotion')),
  override_value integer NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, category, group_number, entry_id, override_type)
);
CREATE INDEX IF NOT EXISTS tournament_group_overrides_event_idx
  ON public.tournament_group_overrides(event_id, category, group_number);
ALTER TABLE public.tournament_group_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read published tournament group overrides" ON public.tournament_group_overrides;
CREATE POLICY "Public can read published tournament group overrides"
  ON public.tournament_group_overrides FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id AND e.status = 'published' AND e.tournament_details_public = true
  ));
DROP POLICY IF EXISTS "Tournament managers manage group overrides" ON public.tournament_group_overrides;
CREATE POLICY "Tournament managers manage group overrides"
  ON public.tournament_group_overrides FOR ALL TO authenticated
  USING (
    public.is_event_manager() AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND (public.is_admin() OR e.organizer_id = auth.uid() OR e.created_by = auth.uid())
    )
  )
  WITH CHECK (
    public.is_event_manager() AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND (public.is_admin() OR e.organizer_id = auth.uid() OR e.created_by = auth.uid())
    )
  );
GRANT SELECT ON public.tournament_group_overrides TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tournament_group_overrides TO authenticated;
