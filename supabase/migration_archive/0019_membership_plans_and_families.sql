-- BEGIN MIGRATION: 0019_membership_plans_and_families.sql
create table if not exists public.membership_plan_settings (
 id integer primary key default 1 check (id=1),
 single_price_cents integer not null default 0 check(single_price_cents>=0),
 family_price_cents integer not null default 0 check(family_price_cents>=0),
 family_max_adults integer not null default 2 check(family_max_adults between 1 and 10),
 family_max_children integer not null default 4 check(family_max_children between 0 and 20),
 season_start_month integer not null default 4 check(season_start_month between 1 and 12),
 season_start_day integer not null default 1 check(season_start_day between 1 and 31),
 season_end_month integer not null default 9 check(season_end_month between 1 and 12),
 season_end_day integer not null default 30 check(season_end_day between 1 and 31),
 updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
insert into public.membership_plan_settings(id) values(1) on conflict(id) do nothing;
create table if not exists public.membership_families (
 id uuid primary key default gen_random_uuid(),
 season_year integer not null,
 paid_at timestamptz,
 paid_by uuid references public.profiles(id),
 payment_id uuid references public.payments(id),
 created_at timestamptz not null default now()
);
create table if not exists public.membership_family_members (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.membership_families(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 invited_by uuid references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','confirmed','declined','removed_next_season')),
 joined_at timestamptz,
 created_at timestamptz not null default now(),
 unique(family_id,user_id)
);
create index if not exists membership_family_members_user_idx on public.membership_family_members(user_id,status);
create table if not exists public.membership_reminder_log (
 id uuid primary key default gen_random_uuid(), season_year integer not null, reminder_type text not null check(reminder_type in ('before','after')),
 user_id uuid not null references public.profiles(id) on delete cascade, sent_at timestamptz not null default now(), unique(season_year,reminder_type,user_id)
);
alter table public.membership_plan_settings enable row level security;
alter table public.membership_families enable row level security;
alter table public.membership_family_members enable row level security;
alter table public.membership_reminder_log enable row level security;
create policy "Approved users read membership plan settings" on public.membership_plan_settings for select to authenticated using(true);
create policy "Admins manage membership plan settings" on public.membership_plan_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "Users read their family groups" on public.membership_families for select to authenticated using(exists(select 1 from public.membership_family_members fm where fm.family_id=id and fm.user_id=auth.uid()));
create policy "Users read family member rows" on public.membership_family_members for select to authenticated using(user_id=auth.uid() or invited_by=auth.uid() or public.is_admin());
create policy "Admins manage families" on public.membership_families for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "Admins manage family members" on public.membership_family_members for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select on public.membership_plan_settings to authenticated;
grant select on public.membership_families,public.membership_family_members to authenticated;
-- END MIGRATION: 0019_membership_plans_and_families.sql
