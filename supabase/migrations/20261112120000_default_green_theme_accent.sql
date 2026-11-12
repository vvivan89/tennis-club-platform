ALTER TABLE public.profiles
  ALTER COLUMN theme_accent SET DEFAULT 'green';

-- Blue was the initial schema default, so convert those initial values to the
-- corrected default. Members can still select blue explicitly in Appearance.
UPDATE public.profiles
SET theme_accent = 'green'
WHERE theme_accent = 'blue';
