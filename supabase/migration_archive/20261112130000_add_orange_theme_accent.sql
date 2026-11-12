ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_accent_check,
  ADD CONSTRAINT profiles_theme_accent_check
    CHECK (theme_accent IN ('blue', 'green', 'orange'));
