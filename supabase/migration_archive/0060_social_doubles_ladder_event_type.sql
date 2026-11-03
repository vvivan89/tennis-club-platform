-- Allow Social Doubles Ladder events while preserving the existing event types.
BEGIN;

DO $$
DECLARE
    existing_check TEXT;
BEGIN
    SELECT pg_get_expr(conbin, conrelid)
    INTO existing_check
    FROM pg_constraint
    WHERE conname = 'events_event_type_check'
      AND conrelid = 'public.events'::regclass
      AND contype = 'c';

    IF existing_check IS NULL THEN
        RAISE EXCEPTION
            'Could not find check constraint events_event_type_check on public.events';
    END IF;

    ALTER TABLE public.events
        DROP CONSTRAINT events_event_type_check;

    EXECUTE format(
        'ALTER TABLE public.events
         ADD CONSTRAINT events_event_type_check
         CHECK ((%s) OR (event_type = %L))',
        existing_check,
        'social_doubles_ladder'
    );
END
$$;

COMMIT;
