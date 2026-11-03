-- BEGIN MIGRATION: 0006_member_suspensions_contacts.sql
-- Member notes and suspension history. Apply after migrations 0001-0005.
create table if not exists public.member_admin_notes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  comment text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.member_admin_notes enable row level security;
drop policy if exists "Admins manage member admin notes" on public.member_admin_notes;
create policy "Admins manage member admin notes" on public.member_admin_notes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.member_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists member_suspensions_user_dates_idx on public.member_suspensions(user_id, starts_on, ends_on);
alter table public.member_suspensions enable row level security;
drop policy if exists "Admins manage member suspensions" on public.member_suspensions;
create policy "Admins manage member suspensions" on public.member_suspensions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Members read own suspensions" on public.member_suspensions;
create policy "Members read own suspensions" on public.member_suspensions
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Names and positions are always visible. Contact details are shown when public, or
-- to a logged-in member with an active and paid membership.
create or replace function public.is_paid_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and (m.payment_status = 'paid' or exists (
        select 1 from public.payments p where p.membership_id = m.id and p.status in ('paid','recorded_manually')
      ))
      and (m.starts_on is null or m.starts_on <= current_date)
      and (m.ends_on is null or m.ends_on >= current_date)
  );
$$;
create or replace view public.public_club_contacts as
select cc.id, cc.position,
       case when cc.is_public or public.is_paid_member() then cc.emails else '{}'::text[] end as emails,
       case when cc.is_public or public.is_paid_member() then cc.phones else '{}'::text[] end as phones,
       cc.sort_order, p.full_name, p.avatar_url, cc.is_public
from public.club_contacts cc
join public.profiles p on p.id = cc.profile_id;
grant select on public.public_club_contacts to anon, authenticated;

-- Block new/updated event registrations for suspended members if the registration
-- is attempted during a suspension or the event falls within the suspension dates.
create or replace function public.reject_suspended_member_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_day date;
begin
  if new.status = 'cancelled' then return new; end if;
  select e.starts_at::date into event_day from public.events e where e.id = new.event_id;
  if exists (
    select 1 from public.member_suspensions s
    where s.user_id = new.user_id
      and (current_date between s.starts_on and s.ends_on
        or (event_day is not null and event_day between s.starts_on and s.ends_on))
  ) then
    raise exception 'Your account is suspended for this period and cannot register for club events.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists prevent_suspended_member_registration on public.registrations;
create trigger prevent_suspended_member_registration before insert or update of status, event_id, user_id
on public.registrations for each row execute function public.reject_suspended_member_registration();
-- END MIGRATION: 0006_member_suspensions_contacts.sql
