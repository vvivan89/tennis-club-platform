-- League tournaments use the existing ladder identity as their shared series configuration,
-- and existing doubles tournament events, registrations, pairs, matches, and scores.
BEGIN;
ALTER TABLE public.social_doubles_ladders
  ADD COLUMN IF NOT EXISTS competition_type text NOT NULL DEFAULT 'ladder',
  ADD COLUMN IF NOT EXISTS season text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tournament_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tournament_rules_html text NOT NULL DEFAULT '';
DO $$ BEGIN
  ALTER TABLE public.social_doubles_ladders ADD CONSTRAINT social_doubles_ladders_competition_type_check CHECK (competition_type IN ('ladder','league'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.league_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES public.social_doubles_ladders(id) ON DELETE CASCADE,
  player_one_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  player_two_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (player_one_id <> player_two_id),
  UNIQUE (league_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS league_teams_pair_unique ON public.league_teams(league_id,least(player_one_id,player_two_id),greatest(player_one_id,player_two_id)) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS league_teams_player_one_unique ON public.league_teams(league_id,player_one_id) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS league_teams_player_two_unique ON public.league_teams(league_id,player_two_id) WHERE status='active';
ALTER TABLE public.tournament_pairs ADD COLUMN IF NOT EXISTS league_team_id uuid REFERENCES public.league_teams(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS tournament_pairs_league_team_event_unique ON public.tournament_pairs(event_id,league_team_id) WHERE league_team_id IS NOT NULL AND status='active';

CREATE OR REPLACE FUNCTION public.prevent_league_gender_change_after_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.competition_type='league' AND (NEW.gender IS DISTINCT FROM OLD.gender OR NEW.competition_type IS DISTINCT FROM OLD.competition_type)
    AND EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=OLD.id AND t.status='active') THEN
    RAISE EXCEPTION 'League gender cannot change after teams are confirmed';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS prevent_league_gender_change_after_confirmation ON public.social_doubles_ladders;
CREATE TRIGGER prevent_league_gender_change_after_confirmation BEFORE UPDATE OF gender,competition_type ON public.social_doubles_ladders FOR EACH ROW EXECUTE FUNCTION public.prevent_league_gender_change_after_confirmation();

CREATE TABLE IF NOT EXISTS public.league_standings_snapshots (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.social_doubles_ladders(id) ON DELETE CASCADE,
  standings jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  configuration_version text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.league_current_standings (
  league_id uuid PRIMARY KEY REFERENCES public.social_doubles_ladders(id) ON DELETE CASCADE,
  standings jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  configuration_version text NOT NULL DEFAULT ''
);

CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text; v_one uuid; v_two uuid; v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender
  FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id INTO v_one,v_two
  FROM public.tournament_participants p1,tournament_participants p2
  WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF v_one IS NULL OR v_two IS NULL THEN RAISE EXCEPTION 'League teams require two approved member accounts'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two) AND p.application_status<>'approved') THEN
    RAISE EXCEPTION 'League participants must be approved members';
  END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two) OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_league_tournament_pair ON public.tournament_pairs;
CREATE TRIGGER validate_league_tournament_pair BEFORE INSERT OR UPDATE OF player_one_id,player_two_id,league_team_id ON public.tournament_pairs FOR EACH ROW EXECUTE FUNCTION public.validate_league_tournament_pair();

CREATE OR REPLACE FUNCTION public.require_established_league_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.status NOT IN ('registered','provisional') THEN RETURN NEW; END IF;
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender FROM public.events e
    JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
    WHERE e.id=NEW.event_id AND e.event_type='tournament';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League registrations must use the league gender category';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND NEW.user_id IN (t.player_one_id,t.player_two_id)) THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_pairs pair
    JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
    JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
    JOIN public.league_teams t ON t.league_id=v_league AND t.status='active'
      AND ((t.player_one_id=p1.user_id AND t.player_two_id=p2.user_id) OR (t.player_one_id=p2.user_id AND t.player_two_id=p1.user_id))
    WHERE pair.event_id=NEW.event_id AND pair.category=NEW.category AND pair.status='active' AND NEW.user_id IN (p1.user_id,p2.user_id)
  ) THEN RAISE EXCEPTION 'Established league members must register with their confirmed partner'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS require_established_league_pair ON public.tournament_participants;
CREATE CONSTRAINT TRIGGER require_established_league_pair AFTER INSERT OR UPDATE ON public.tournament_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_established_league_pair();

CREATE OR REPLACE FUNCTION public.confirm_league_tournament_teams(p_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_count integer;
BEGIN
  SELECT e.social_doubles_ladder_id INTO v_league FROM public.events e
    JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
    WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL OR NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  WITH new_pairs AS (
    SELECT DISTINCT ON (least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id))
      pair.id AS pair_id,p1.user_id AS one_id,p2.user_id AS two_id
    FROM public.tournament_pairs pair
    JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
    JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
    WHERE pair.event_id=p_event_id AND pair.status='active' AND p1.status='registered' AND p2.status='registered'
      AND p1.user_id IS NOT NULL AND p2.user_id IS NOT NULL
    ORDER BY least(p1.user_id,p2.user_id),greatest(p1.user_id,p2.user_id),pair.created_at,pair.id
  ), created AS (
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
    SELECT v_league,one_id,two_id FROM new_pairs np
    WHERE NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
      AND ((t.player_one_id=np.one_id AND t.player_two_id=np.two_id) OR (t.player_one_id=np.two_id AND t.player_two_id=np.one_id)))
    RETURNING id
  ) SELECT count(*) INTO v_count FROM created;
  UPDATE public.tournament_pairs pair SET league_team_id=t.id
  FROM public.tournament_participants p1, public.tournament_participants p2, public.league_teams t
  WHERE pair.event_id=p_event_id AND pair.status='active' AND p1.id=pair.player_one_id AND p2.id=pair.player_two_id
    AND t.league_id=v_league AND t.status='active' AND ((t.player_one_id=p1.user_id AND t.player_two_id=p2.user_id) OR (t.player_one_id=p2.user_id AND t.player_two_id=p1.user_id));
  RETURN coalesce(v_count,0);
END; $$;
REVOKE ALL ON FUNCTION public.confirm_league_tournament_teams(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_league_tournament_teams(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.league_standings_json(p_league_id uuid,p_before timestamptz DEFAULT NULL,p_before_event uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH config AS (
    SELECT coalesce(tournament_config,'{}'::jsonb) AS cfg FROM public.social_doubles_ladders WHERE id=p_league_id AND competition_type='league'
  ), appearances AS (
    SELECT m.id AS match_id,m.status,m.winner_side,m.score_sets,m.event_id,
      CASE WHEN m.pair_one_id=pair.id THEN 1 ELSE 2 END AS side,pair.league_team_id AS team_id
    FROM public.tournament_matches m
    JOIN public.events e ON e.id=m.event_id AND e.social_doubles_ladder_id=p_league_id
    JOIN public.tournament_pairs pair ON pair.id IN (m.pair_one_id,m.pair_two_id) AND pair.league_team_id IS NOT NULL
    WHERE m.status IN ('completed','bye') AND (p_before IS NULL OR (e.starts_at,e.id)<(p_before,p_before_event))
  ), scored AS (
    SELECT a.*,
      coalesce((SELECT count(*) FROM jsonb_array_elements(a.score_sets) s WHERE CASE WHEN a.side=1 THEN (s->>'one')::integer>(s->>'two')::integer ELSE (s->>'two')::integer>(s->>'one')::integer END),0)::integer AS sets_won,
      coalesce((SELECT count(*) FROM jsonb_array_elements(a.score_sets) s WHERE CASE WHEN a.side=1 THEN (s->>'one')::integer<(s->>'two')::integer ELSE (s->>'two')::integer<(s->>'one')::integer END),0)::integer AS sets_lost,
      coalesce((SELECT sum(CASE WHEN a.side=1 THEN (s->>'one')::integer ELSE (s->>'two')::integer END) FROM jsonb_array_elements(a.score_sets) s),0)::integer AS games_won,
      coalesce((SELECT sum(CASE WHEN a.side=1 THEN (s->>'two')::integer ELSE (s->>'one')::integer END) FROM jsonb_array_elements(a.score_sets) s),0)::integer AS games_lost
    FROM appearances a
  ), stats AS (
    SELECT t.id AS team_id,t.player_one_id,t.player_two_id,
      coalesce(sum(CASE WHEN s.status='bye' THEN coalesce((config.cfg->'league_points'->>'bye')::integer,0)
        WHEN s.status='completed' AND s.winner_side IS NULL THEN coalesce((config.cfg->'league_points'->>'draw')::integer,0)
        WHEN s.status='completed' AND s.winner_side=s.side THEN coalesce((config.cfg->'league_points'->>'win')::integer,3)
        WHEN s.status='completed' THEN coalesce((config.cfg->'league_points'->>'loss')::integer,0) ELSE 0 END),0)::integer AS points,
      count(*) FILTER (WHERE s.status='completed')::integer AS played,
      count(*) FILTER (WHERE s.status='completed' AND s.winner_side=s.side)::integer AS wins,
      count(*) FILTER (WHERE s.status='completed' AND s.winner_side IS NOT NULL AND s.winner_side<>s.side)::integer AS losses,
      coalesce(sum(s.sets_won),0)::integer AS sets_won,coalesce(sum(s.sets_lost),0)::integer AS sets_lost,
      coalesce(sum(s.games_won),0)::integer AS games_won,coalesce(sum(s.games_lost),0)::integer AS games_lost
    FROM public.league_teams t CROSS JOIN config LEFT JOIN scored s ON s.team_id=t.id
    WHERE t.league_id=p_league_id AND t.status='active' AND t.confirmed_at IS NOT NULL
      AND (p_before IS NULL OR t.confirmed_at<p_before)
    GROUP BY t.id,t.player_one_id,t.player_two_id,config.cfg
  ), ordered AS (
    SELECT stats.*, ARRAY(SELECT CASE metric
      WHEN 'points' THEN stats.points WHEN 'matches_won' THEN stats.wins WHEN 'matches_played' THEN stats.played
      WHEN 'sets_won' THEN stats.sets_won WHEN 'sets_lost' THEN stats.sets_lost WHEN 'set_difference' THEN stats.sets_won-stats.sets_lost
      WHEN 'games_won' THEN stats.games_won WHEN 'game_difference' THEN stats.games_won-stats.games_lost ELSE 0 END
      FROM unnest((SELECT coalesce(array_agg(value),ARRAY['matches_won','sets_won','games_won']) FROM config c CROSS JOIN LATERAL jsonb_array_elements_text(c.cfg->'ranking_priority') value)) WITH ORDINALITY p(metric,ord) ORDER BY ord) AS rank_values
    FROM stats
  ), ranked AS (SELECT ordered.*,row_number() OVER (ORDER BY rank_values DESC,team_id) AS position FROM ordered)
  SELECT coalesce(jsonb_agg(jsonb_build_object('team_id',r.team_id,'player_one_id',r.player_one_id,'player_two_id',r.player_two_id,
    'team_name',coalesce(nullif(a.full_name,''),'Player')||' + '||coalesce(nullif(b.full_name,''),'Player'),
    'position',r.position,'points',r.points,'matches_played',r.played,'wins',r.wins,'losses',r.losses,
    'sets_won',r.sets_won,'sets_lost',r.sets_lost,'games_won',r.games_won,'games_lost',r.games_lost) ORDER BY r.position),'[]'::jsonb)
  FROM ranked r LEFT JOIN public.profiles a ON a.id=r.player_one_id LEFT JOIN public.profiles b ON b.id=r.player_two_id;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_league_tournament_standings(p_league_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event record; v_config text; v_current jsonb;
BEGIN
  SELECT md5(row_to_json(l)::text) INTO v_config FROM public.social_doubles_ladders l WHERE l.id=p_league_id AND l.competition_type='league';
  IF v_config IS NULL THEN RETURN; END IF;
  FOR v_event IN SELECT id,starts_at FROM public.events WHERE social_doubles_ladder_id=p_league_id ORDER BY starts_at,id LOOP
    INSERT INTO public.league_standings_snapshots(event_id,league_id,standings,configuration_version)
    VALUES(v_event.id,p_league_id,public.league_standings_json(p_league_id,v_event.starts_at,v_event.id),v_config)
    ON CONFLICT(event_id) DO UPDATE SET standings=EXCLUDED.standings,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
  END LOOP;
  v_current := public.league_standings_json(p_league_id,NULL,NULL);
  INSERT INTO public.league_current_standings(league_id,standings,configuration_version)
  VALUES(p_league_id,v_current,v_config)
  ON CONFLICT(league_id) DO UPDATE SET standings=EXCLUDED.standings,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
END; $$;
REVOKE ALL ON FUNCTION public.league_standings_json(uuid,timestamptz,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.recalculate_league_tournament_standings(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.refresh_league_tournament_standings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid;
BEGIN
  IF TG_TABLE_NAME='social_doubles_ladders' THEN v_league := coalesce((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
  ELSIF TG_TABLE_NAME='events' THEN v_league := coalesce((to_jsonb(NEW)->>'social_doubles_ladder_id')::uuid,(to_jsonb(OLD)->>'social_doubles_ladder_id')::uuid);
  ELSIF TG_TABLE_NAME='league_teams' THEN v_league := coalesce((to_jsonb(NEW)->>'league_id')::uuid,(to_jsonb(OLD)->>'league_id')::uuid);
  ELSE
    SELECT e.social_doubles_ladder_id INTO v_league FROM public.events e WHERE e.id=coalesce((to_jsonb(NEW)->>'event_id')::uuid,(to_jsonb(OLD)->>'event_id')::uuid);
  END IF;
  IF v_league IS NOT NULL THEN PERFORM public.recalculate_league_tournament_standings(v_league); END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS refresh_league_standings_from_matches ON public.tournament_matches;
CREATE TRIGGER refresh_league_standings_from_matches AFTER INSERT OR UPDATE OR DELETE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_pairs ON public.tournament_pairs;
CREATE TRIGGER refresh_league_standings_from_pairs AFTER INSERT OR UPDATE OR DELETE ON public.tournament_pairs FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_teams ON public.league_teams;
CREATE TRIGGER refresh_league_standings_from_teams AFTER INSERT OR UPDATE OR DELETE ON public.league_teams FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_events ON public.events;
CREATE TRIGGER refresh_league_standings_from_events AFTER INSERT OR UPDATE OR DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();
DROP TRIGGER IF EXISTS refresh_league_standings_from_config ON public.social_doubles_ladders;
CREATE TRIGGER refresh_league_standings_from_config AFTER UPDATE OF tournament_config,gender,starts_at,ends_at ON public.social_doubles_ladders FOR EACH ROW EXECUTE FUNCTION public.refresh_league_tournament_standings();

CREATE OR REPLACE FUNCTION public.sync_league_config_to_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.competition_type='league' AND (OLD.tournament_config IS DISTINCT FROM NEW.tournament_config OR OLD.gender IS DISTINCT FROM NEW.gender OR OLD.tournament_rules_html IS DISTINCT FROM NEW.tournament_rules_html) THEN
    UPDATE public.events SET tournament_config=NEW.tournament_config,tournament_rules_html=NEW.tournament_rules_html,gender_restriction=NEW.gender
      WHERE social_doubles_ladder_id=NEW.id AND event_type='tournament';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sync_league_config_to_events ON public.social_doubles_ladders;
CREATE TRIGGER sync_league_config_to_events AFTER UPDATE ON public.social_doubles_ladders FOR EACH ROW EXECUTE FUNCTION public.sync_league_config_to_events();

ALTER TABLE public.league_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_standings_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_current_standings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved members view league teams" ON public.league_teams FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'));
CREATE POLICY "Approved members view league snapshots" ON public.league_standings_snapshots FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'));
CREATE POLICY "Public view published league snapshots" ON public.league_standings_snapshots FOR SELECT TO anon USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=league_standings_snapshots.event_id AND e.status='published' AND e.tournament_details_public=true));
CREATE POLICY "Approved members view league current standings" ON public.league_current_standings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'));
GRANT SELECT ON public.league_teams,public.league_standings_snapshots,public.league_current_standings TO authenticated;
GRANT SELECT ON public.league_standings_snapshots TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.social_doubles_ladders TO authenticated;
COMMIT;
