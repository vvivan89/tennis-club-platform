-- BEGIN MIGRATION: 0026_readable_event_slugs.sql
-- Canonical event URLs use <title-slug>-<YYYY-MM-DD>-<HH-mm> in America/Vancouver.
-- If that base URL is already in use, append -2, -3, ... to keep every URL unique.

create table if not exists public.event_slug_aliases (
  slug text primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.event_slug_aliases enable row level security;
drop policy if exists "Event slug aliases are readable" on public.event_slug_aliases;
create policy "Event slug aliases are readable"
  on public.event_slug_aliases for select to anon, authenticated using (true);

create or replace function public.event_slug_base(p_title text, p_starts_at timestamptz)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  title_part text;
begin
  title_part := trim(both '-' from regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g'));
  title_part := trim(both '-' from left(title_part, 100));
  if title_part = '' then title_part := 'event'; end if;
  return title_part || '-' || to_char(p_starts_at at time zone 'America/Vancouver', 'YYYY-MM-DD-HH24-MI');
end;
$$;

create or replace function public.set_event_readable_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
begin
  if tg_op = 'INSERT'
     or new.slug is null
     or new.title is distinct from old.title
     or new.starts_at is distinct from old.starts_at then
    base_slug := public.event_slug_base(new.title, new.starts_at);

    -- Serialize concurrent attempts for the same base slug; the unique index below
    -- remains the final database-level guarantee.
    perform pg_advisory_xact_lock(hashtext(base_slug));
    candidate := base_slug;

    while exists (
      select 1 from public.events e
      where e.slug = candidate and e.id is distinct from new.id
    ) or exists (
      select 1 from public.event_slug_aliases a
      where a.slug = candidate and a.event_id is distinct from new.id
    ) loop
      suffix := suffix + 1;
      candidate := base_slug || '-' || suffix::text;
    end loop;

    if tg_op = 'UPDATE' and old.slug is not null and old.slug <> candidate then
      insert into public.event_slug_aliases(slug, event_id)
      values (old.slug, old.id)
      on conflict (slug) do nothing;
    end if;

    new.slug := candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists set_event_readable_slug on public.events;
create trigger set_event_readable_slug
  before insert or update on public.events
  for each row execute function public.set_event_readable_slug();

-- Backfill existing events through the same collision-safe slug generator.
update public.events set slug = null;

-- Explicit unique index documenting and enforcing uniqueness for generated slugs.
create unique index if not exists events_slug_unique_idx
  on public.events(slug) where slug is not null;
-- END MIGRATION: 0026_readable_event_slugs.sql
