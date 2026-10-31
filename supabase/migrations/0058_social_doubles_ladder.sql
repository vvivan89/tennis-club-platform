-- Social Doubles Ladder: persistent competition identity and event configuration.
create table if not exists public.social_doubles_ladders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gender text not null check (gender in ('male','female')),
  position_points integer[] not null default array[2,1,-1,-2],
  ranking_priority text[] not null default array['games_won','sets_won','games_difference'],
  carryover_mode text not null default 'none' check (carryover_mode in ('none','position','full')),
  previous_ladder_id uuid references public.social_doubles_ladders(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (array_length(position_points, 1) = 4),
  check (cardinality(ranking_priority) > 0)
);
alter table public.events
  add column if not exists social_doubles_ladder_id uuid references public.social_doubles_ladders(id) on delete set null,
  add column if not exists ladder_gender text check (ladder_gender is null or ladder_gender in ('male','female')),
  add column if not exists ladder_position_points integer[],
  add column if not exists ladder_ranking_priority text[];

create index if not exists events_social_doubles_ladder_idx
  on public.events(social_doubles_ladder_id, starts_at);
create index if not exists social_doubles_ladders_ends_at_idx
  on public.social_doubles_ladders(ends_at desc nulls last);

alter table public.social_doubles_ladders enable row level security;
drop policy if exists "Approved users can view social doubles ladders" on public.social_doubles_ladders;
create policy "Approved users can view social doubles ladders"
  on public.social_doubles_ladders for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'));
drop policy if exists "Admins and organizers manage social doubles ladders" on public.social_doubles_ladders;
create policy "Admins and organizers manage social doubles ladders"
  on public.social_doubles_ladders for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'
      and (p.role = 'admin' or p.role = 'organizer' or created_by = auth.uid()))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'
      and (p.role = 'admin' or p.role = 'organizer' or created_by = auth.uid()))
  );

comment on table public.social_doubles_ladders is 'Seasonal Social Doubles Ladder identities; each ladder is strictly mens or womens.';
comment on column public.events.social_doubles_ladder_id is 'Links a social doubles ladder session to its cumulative ladder.';


create table if not exists public.social_doubles_ladder_seeds (
  ladder_id uuid not null references public.social_doubles_ladders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  initial_position integer not null check (initial_position > 0),
  initial_points integer not null default 0,
  primary key (ladder_id, user_id),
  unique (ladder_id, initial_position)
);
alter table public.social_doubles_ladder_seeds enable row level security;
drop policy if exists "Approved users can view ladder seeds" on public.social_doubles_ladder_seeds;
create policy "Approved users can view ladder seeds" on public.social_doubles_ladder_seeds
  for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved'));
drop policy if exists "Admins and organizers manage ladder seeds" on public.social_doubles_ladder_seeds;
create policy "Admins and organizers manage ladder seeds" on public.social_doubles_ladder_seeds
  for all to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved' and (p.role = 'admin' or p.role = 'organizer')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.application_status = 'approved' and (p.role = 'admin' or p.role = 'organizer')));

GRANT SELECT ON public.social_doubles_ladders TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.social_doubles_ladders TO authenticated;
GRANT SELECT ON public.social_doubles_ladder_seeds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.social_doubles_ladder_seeds TO authenticated;
