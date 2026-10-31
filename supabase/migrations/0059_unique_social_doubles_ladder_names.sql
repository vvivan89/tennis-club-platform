-- Ladder names are identities across events/seasons and must be unique, case-insensitively.
create unique index if not exists social_doubles_ladders_name_ci_unique
  on public.social_doubles_ladders (lower(btrim(name)));
