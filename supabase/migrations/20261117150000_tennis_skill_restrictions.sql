-- Optional tennis skill bounds for social doubles ladders, Leagues, and doubles tournaments.
ALTER TABLE public.social_doubles_ladders
  ADD COLUMN IF NOT EXISTS minimum_tennis_skill_level numeric(2,1),
  ADD COLUMN IF NOT EXISTS maximum_tennis_skill_level numeric(2,1);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_doubles_ladders_min_skill_check') THEN
    ALTER TABLE public.social_doubles_ladders ADD CONSTRAINT social_doubles_ladders_min_skill_check
      CHECK (minimum_tennis_skill_level IS NULL OR (minimum_tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(minimum_tennis_skill_level - 2.5, 0.5) = 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_doubles_ladders_max_skill_check') THEN
    ALTER TABLE public.social_doubles_ladders ADD CONSTRAINT social_doubles_ladders_max_skill_check
      CHECK (maximum_tennis_skill_level IS NULL OR (maximum_tennis_skill_level BETWEEN 2.5 AND 7.0 AND mod(maximum_tennis_skill_level - 2.5, 0.5) = 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_doubles_ladders_skill_range_check') THEN
    ALTER TABLE public.social_doubles_ladders ADD CONSTRAINT social_doubles_ladders_skill_range_check
      CHECK (minimum_tennis_skill_level IS NULL OR maximum_tennis_skill_level IS NULL OR minimum_tennis_skill_level <= maximum_tennis_skill_level);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_league_config_to_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.competition_type = 'league'
    AND (OLD.tournament_config IS DISTINCT FROM NEW.tournament_config
      OR OLD.gender IS DISTINCT FROM NEW.gender
      OR OLD.tournament_rules_html IS DISTINCT FROM NEW.tournament_rules_html
      OR OLD.minimum_tennis_skill_level IS DISTINCT FROM NEW.minimum_tennis_skill_level
      OR OLD.maximum_tennis_skill_level IS DISTINCT FROM NEW.maximum_tennis_skill_level) THEN
    UPDATE public.events
    SET tournament_config = coalesce(NEW.tournament_config, '{}'::jsonb)
          || jsonb_build_object(
            'minimum_tennis_skill_level', NEW.minimum_tennis_skill_level,
            'maximum_tennis_skill_level', NEW.maximum_tennis_skill_level
          ),
        tournament_rules_html = NEW.tournament_rules_html,
        gender_restriction = CASE WHEN NEW.gender IN ('male', 'female') THEN NEW.gender ELSE NULL END,
        ladder_gender = NEW.gender
    WHERE social_doubles_ladder_id = NEW.id AND event_type = 'tournament';
  ELSIF NEW.competition_type IS DISTINCT FROM 'league'
    AND (OLD.minimum_tennis_skill_level IS DISTINCT FROM NEW.minimum_tennis_skill_level
      OR OLD.maximum_tennis_skill_level IS DISTINCT FROM NEW.maximum_tennis_skill_level) THEN
    UPDATE public.events
    SET tournament_config = coalesce(tournament_config, '{}'::jsonb)
          || jsonb_build_object(
            'minimum_tennis_skill_level', NEW.minimum_tennis_skill_level,
            'maximum_tennis_skill_level', NEW.maximum_tennis_skill_level
          )
    WHERE social_doubles_ladder_id = NEW.id AND event_type = 'social_doubles_ladder';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_tournament_participant_skill_range()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_format text;
  v_config jsonb;
  v_ladder_id uuid;
  v_competition_type text;
  v_minimum numeric;
  v_maximum numeric;
  v_skill numeric;
  v_profile_skill numeric;
  v_approved_member boolean := false;
BEGIN
  SELECT event.tournament_format, event.tournament_config, event.social_doubles_ladder_id
    INTO v_format, v_config, v_ladder_id
  FROM public.events event
  WHERE event.id = NEW.event_id AND event.event_type = 'tournament';
  IF NOT FOUND OR v_format IS DISTINCT FROM 'doubles' THEN RETURN NEW; END IF;

  IF v_ladder_id IS NOT NULL THEN
    SELECT competition_type INTO v_competition_type
    FROM public.social_doubles_ladders WHERE id = v_ladder_id;
  END IF;
  IF v_competition_type = 'league' THEN
    SELECT minimum_tennis_skill_level, maximum_tennis_skill_level
      INTO v_minimum, v_maximum
    FROM public.social_doubles_ladders WHERE id = v_ladder_id;
  ELSE
    v_minimum := nullif(v_config ->> 'minimum_tennis_skill_level', '')::numeric;
    v_maximum := nullif(v_config ->> 'maximum_tennis_skill_level', '')::numeric;
  END IF;
  IF v_minimum IS NULL AND v_maximum IS NULL THEN RETURN NEW; END IF;

  v_skill := NEW.tennis_skill_level;
  IF NEW.user_id IS NOT NULL THEN
    SELECT profile.tennis_skill_level::numeric,
      profile.account_kind = 'member' AND profile.application_status = 'approved'
      INTO v_profile_skill, v_approved_member
    FROM public.profiles profile WHERE profile.id = NEW.user_id;
    IF v_approved_member OR v_profile_skill IS NOT NULL THEN
      v_skill := v_profile_skill;
    END IF;
  END IF;
  IF v_skill IS NULL THEN
    RAISE EXCEPTION 'A tennis skill rating is required for this event''s skill restriction';
  END IF;
  IF (v_minimum IS NOT NULL AND v_skill < v_minimum)
    OR (v_maximum IS NOT NULL AND v_skill > v_maximum) THEN
    RAISE EXCEPTION 'Tennis skill rating must be between % and % for this event',
      coalesce(v_minimum::text, '2.5'), coalesce(v_maximum::text, '7.0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_tournament_participant_skill_range ON public.tournament_participants;
CREATE TRIGGER enforce_tournament_participant_skill_range
BEFORE INSERT OR UPDATE OF event_id, user_id, tennis_skill_level ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_tournament_participant_skill_range();

CREATE OR REPLACE FUNCTION public.enforce_ladder_registration_skill_range()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_minimum numeric;
  v_maximum numeric;
  v_skill numeric;
BEGIN
  SELECT ladder.minimum_tennis_skill_level, ladder.maximum_tennis_skill_level,
    profile.tennis_skill_level::numeric
  INTO v_minimum, v_maximum, v_skill
  FROM public.events event
  JOIN public.social_doubles_ladders ladder ON ladder.id = event.social_doubles_ladder_id
  JOIN public.profiles profile ON profile.id = NEW.user_id
  WHERE event.id = NEW.event_id AND event.event_type = 'social_doubles_ladder';
  IF NOT FOUND OR (v_minimum IS NULL AND v_maximum IS NULL) THEN RETURN NEW; END IF;
  IF v_skill IS NULL THEN
    RAISE EXCEPTION 'A tennis skill rating is required for this ladder''s skill restriction';
  END IF;
  IF (v_minimum IS NOT NULL AND v_skill < v_minimum)
    OR (v_maximum IS NOT NULL AND v_skill > v_maximum) THEN
    RAISE EXCEPTION 'Tennis skill rating is outside this ladder''s allowed range';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_ladder_registration_skill_range ON public.registrations;
CREATE TRIGGER enforce_ladder_registration_skill_range
BEFORE INSERT OR UPDATE OF event_id, user_id ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.enforce_ladder_registration_skill_range();

-- Public Ladder event pages cannot read the private competition identity, so mirror its
-- display range onto each linked event. The database checks still use the identity row.
UPDATE public.events event
SET tournament_config = coalesce(event.tournament_config, '{}'::jsonb)
      || jsonb_build_object(
        'minimum_tennis_skill_level', ladder.minimum_tennis_skill_level,
        'maximum_tennis_skill_level', ladder.maximum_tennis_skill_level
      )
FROM public.social_doubles_ladders ladder
WHERE ladder.id = event.social_doubles_ladder_id
  AND event.event_type = 'social_doubles_ladder';
