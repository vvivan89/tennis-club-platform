-- Store both pre-event and post-event standings for League event pages.
BEGIN;
ALTER TABLE public.league_standings_snapshots ADD COLUMN IF NOT EXISTS standings_after jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.league_standings_json(p_league_id uuid,p_before timestamptz,p_before_event uuid,p_include_event boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH config AS (
    SELECT coalesce(tournament_config,'{}'::jsonb) AS cfg FROM public.social_doubles_ladders WHERE id=p_league_id AND competition_type='league'
  ), appearances AS (
    SELECT m.id AS match_id,m.status,m.winner_side,m.score_sets,m.event_id,
      CASE WHEN m.pair_one_id=pair.id THEN 1 ELSE 2 END AS side,pair.league_team_id AS team_id
    FROM public.tournament_matches m
    JOIN public.events e ON e.id=m.event_id AND e.social_doubles_ladder_id=p_league_id
    JOIN public.tournament_pairs pair ON pair.id IN (m.pair_one_id,m.pair_two_id) AND pair.league_team_id IS NOT NULL
    WHERE m.status IN ('completed','bye') AND ((p_before IS NULL OR (e.starts_at,e.id)<(p_before,p_before_event)) OR (p_include_event AND e.id=p_before_event))
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
      AND (p_before IS NULL OR t.confirmed_at<p_before OR (p_include_event AND EXISTS (SELECT 1 FROM public.tournament_pairs p WHERE p.event_id=p_before_event AND p.league_team_id=t.id AND p.status='active')))
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

CREATE OR REPLACE FUNCTION public.league_standings_json(p_league_id uuid,p_before timestamptz DEFAULT NULL,p_before_event uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.league_standings_json(p_league_id,p_before,p_before_event,false);
$$;

REVOKE ALL ON FUNCTION public.league_standings_json(uuid,timestamptz,uuid,boolean) FROM PUBLIC,anon;

CREATE OR REPLACE FUNCTION public.recalculate_league_tournament_standings(p_league_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event record; v_config text; v_current jsonb;
BEGIN
  SELECT md5(row_to_json(l)::text) INTO v_config FROM public.social_doubles_ladders l WHERE l.id=p_league_id AND l.competition_type='league';
  IF v_config IS NULL THEN RETURN; END IF;
  FOR v_event IN SELECT id,starts_at FROM public.events WHERE social_doubles_ladder_id=p_league_id ORDER BY starts_at,id LOOP
    INSERT INTO public.league_standings_snapshots(event_id,league_id,standings,standings_after,configuration_version)
    VALUES(v_event.id,p_league_id,public.league_standings_json(p_league_id,v_event.starts_at,v_event.id),public.league_standings_json(p_league_id,v_event.starts_at,v_event.id,true),v_config)
    ON CONFLICT(event_id) DO UPDATE SET standings=EXCLUDED.standings,standings_after=EXCLUDED.standings_after,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
  END LOOP;
  v_current := public.league_standings_json(p_league_id,NULL,NULL);
  INSERT INTO public.league_current_standings(league_id,standings,configuration_version)
  VALUES(p_league_id,v_current,v_config)
  ON CONFLICT(league_id) DO UPDATE SET standings=EXCLUDED.standings,calculated_at=now(),configuration_version=EXCLUDED.configuration_version;
END; $$;
COMMIT;
