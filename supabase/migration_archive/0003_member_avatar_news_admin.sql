-- BEGIN MIGRATION: 0003_member_avatar_news_admin.sql
-- PCTC member ratings, required phone, avatars, club profile and public news.
alter table public.profiles add column if not exists avatar_url text;
-- New signups and profile edits require phone numbers; existing nullable rows remain valid until members update them.
alter table public.profiles drop constraint if exists profiles_tennis_skill_level_check;
update public.profiles set tennis_skill_level = case tennis_skill_level when 'beginner' then '2.5' when 'beginner_intermediate' then '3.0' when 'intermediate' then '3.5' when 'advanced' then '4.5' when 'competitive' then '5.5' else tennis_skill_level end
where tennis_skill_level in ('beginner','beginner_intermediate','intermediate','advanced','competitive');
alter table public.profiles add constraint profiles_tennis_skill_level_check
  check (tennis_skill_level is null or tennis_skill_level in ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'tennis_skill_level', '') not in ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') then
    raise exception 'A valid tennis skill rating is required to register.';
  end if;
  if coalesce(trim(new.raw_user_meta_data ->> 'phone'), '') = '' then
    raise exception 'A phone number is required to register.';
  end if;
  insert into public.profiles (id, email, full_name, phone, tennis_skill_level)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name',''), trim(new.raw_user_meta_data ->> 'phone'), new.raw_user_meta_data ->> 'tennis_skill_level');
  return new;
end;
$$;

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.news enable row level security;
drop policy if exists "Public read published news" on public.news;
create policy "Public read published news" on public.news for select to anon, authenticated using (published or public.is_admin());
drop policy if exists "Admins manage news" on public.news;
create policy "Admins manage news" on public.news for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.news to anon, authenticated;
grant insert, update, delete on public.news to authenticated;

create table if not exists public.club_settings (
  id integer primary key default 1 check (id = 1),
  club_name text not null default 'Port Coquitlam Tennis Club',
  short_name text not null default 'PCTC',
  description text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  website_url text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.club_settings (id) values (1) on conflict (id) do nothing;
alter table public.club_settings enable row level security;
drop policy if exists "Public read club settings" on public.club_settings;
create policy "Public read club settings" on public.club_settings for select to anon, authenticated using (true);
drop policy if exists "Admins manage club settings" on public.club_settings;
create policy "Admins manage club settings" on public.club_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.club_settings to anon, authenticated;
grant insert, update, delete on public.club_settings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-avatars', 'member-avatars', true, 3145728, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];
drop policy if exists "Members upload own avatar" on storage.objects;
create policy "Members upload own avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Members update own avatar" on storage.objects;
create policy "Members update own avatar" on storage.objects for update to authenticated
using (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Members delete own avatar" on storage.objects;
create policy "Members delete own avatar" on storage.objects for delete to authenticated
using (bucket_id = 'member-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- END MIGRATION: 0003_member_avatar_news_admin.sql
