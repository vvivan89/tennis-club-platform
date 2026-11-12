ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_mode text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS theme_accent text NOT NULL DEFAULT 'blue';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_mode_check,
  ADD CONSTRAINT profiles_theme_mode_check
    CHECK (theme_mode IN ('light', 'dark', 'system')),
  DROP CONSTRAINT IF EXISTS profiles_theme_accent_check,
  ADD CONSTRAINT profiles_theme_accent_check
    CHECK (theme_accent IN ('blue', 'green'));
