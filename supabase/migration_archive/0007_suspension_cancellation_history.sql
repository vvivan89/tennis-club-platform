-- BEGIN MIGRATION: 0007_suspension_cancellation_history.sql
-- Preserve suspension history when an administrator removes/cancels a suspension.
alter table public.member_suspensions
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id);

create or replace function public.reject_suspended_member_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_day date;
begin
  if new.status = 'cancelled' then return new; end if;
  select e.starts_at::date into event_day from public.events e where e.id = new.event_id;
  if exists (
    select 1 from public.member_suspensions s
    where s.user_id = new.user_id and s.cancelled_at is null
      and (current_date between s.starts_on and s.ends_on
        or (event_day is not null and event_day between s.starts_on and s.ends_on))
  ) then
    raise exception 'Your account is suspended for this period and cannot register for club events.' using errcode = '42501';
  end if;
  return new;
end;
$$;
-- END MIGRATION: 0007_suspension_cancellation_history.sql
