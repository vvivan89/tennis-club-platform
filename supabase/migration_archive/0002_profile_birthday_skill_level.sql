-- BEGIN MIGRATION: 0002_profile_birthday_skill_level.sql
-- PCTC profile fields: birthday display preference and required skill level for new signups.
-- Safe to apply to a project that already ran 0001_initial_schema.sql.
alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists show_birthday_emoji boolean not null default false,
  add column if not exists tennis_skill_level text;

alter table public.profiles
  drop constraint if exists profiles_tennis_skill_level_check;
alter table public.profiles
  add constraint profiles_tennis_skill_level_check
  check (tennis_skill_level is null or tennis_skill_level in ('beginner','beginner_intermediate','intermediate','advanced','competitive'));

-- Require a valid skill level on all new auth signups. Existing profiles can fill it in later.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'tennis_skill_level', '') not in ('beginner','beginner_intermediate','intermediate','advanced','competitive') then
    raise exception 'A valid tennis skill level is required to register.';
  end if;
  insert into public.profiles (id, email, full_name, tennis_skill_level)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name',''), new.raw_user_meta_data ->> 'tennis_skill_level');
  return new;
end;
$$;

-- Permit admins to edit their own profile without allowing members to promote themselves.
drop policy if exists "Members update own profile" on public.profiles;
create policy "Members update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and role = 'member')
  with check (id = (select auth.uid()) and role = 'member');
-- END MIGRATION: 0002_profile_birthday_skill_level.sql
