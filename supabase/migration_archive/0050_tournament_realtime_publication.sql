-- Keep public and administrator tournament views synchronized with changes made by organizers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'events',
    'tournament_teams',
    'tournament_participants',
    'tournament_pairs',
    'tournament_matches',
    'tournament_match_players',
    'tournament_audit_log'
  ] loop
    if to_regclass('public.' || table_name) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

-- Emit a public event-row change whenever tournament data changes. This lets
-- public clients refresh even when the underlying participant tables are private.
create or replace function public.bump_tournament_event_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if tg_table_name = 'tournament_match_players' then
    if tg_op = 'DELETE' then
      select event_id into v_event_id from public.tournament_matches where id = old.match_id;
    else
      select event_id into v_event_id from public.tournament_matches where id = new.match_id;
    end if;
  else
    if tg_op = 'DELETE' then
      v_event_id := old.event_id;
    else
      v_event_id := new.event_id;
    end if;
  end if;

  if v_event_id is not null then
    update public.events set updated_at = now() where id = v_event_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.bump_tournament_event_updated_at() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tournament_teams',
    'tournament_participants',
    'tournament_pairs',
    'tournament_matches',
    'tournament_match_players',
    'tournament_audit_log'
  ] loop
    execute format('drop trigger if exists bump_event_updated_at on public.%I', table_name);
    execute format(
      'create trigger bump_event_updated_at after insert or update or delete on public.%I for each row execute function public.bump_tournament_event_updated_at()',
      table_name
    );
  end loop;
end;
$$;
