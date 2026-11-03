import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { GroupOverride } from '@/components/tournament-public-view-types';
import type { GroupStanding } from '@/components/tournament-public-group-standings';

type OverrideEditor = {
  category: string;
  group: number;
  rows: Array<{ id: string; name: string; promoted: boolean }>;
};
type Db = ReturnType<typeof createSupabaseBrowserClient>;

export function useTournamentGroupOverrideActions({
  db,
  eventId,
  format,
  config,
  enabledPhases,
  groupOverrides,
  setGroupOverrides,
  groupStandings,
}: {
  db: Db;
  eventId: string;
  format: string | null;
  config: { promoted_teams_per_group?: number | null } | null;
  enabledPhases: Record<string, boolean | undefined>;
  groupOverrides: GroupOverride[];
  setGroupOverrides: Dispatch<SetStateAction<GroupOverride[]>>;
  groupStandings: GroupStanding[];
}) {
  const [overrideEditor, setOverrideEditor] = useState<OverrideEditor | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState('');
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);

  function openGroupOverrideEditor(group: GroupStanding) {
    const promotionEnabled =
      format === 'team'
        ? enabledPhases.team_round_robin !== false && enabledPhases.team_knockout !== false
        : enabledPhases.round_robin !== false && enabledPhases.final_knockout !== false;
    setOverrideEditor({
      category: group.category,
      group: group.group,
      rows: group.standings.map((row, index) => {
        const promotionOverride = groupOverrides.find(
          (item) =>
            item.category === group.category &&
            item.group_number === group.group &&
            item.entry_id === row.id &&
            item.override_type === 'promotion',
        );
        const automaticallyPromoted =
          group.standings.some((standing) => standing.played > 0) &&
          promotionEnabled &&
          index < Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
        return {
          id: row.id,
          name: row.name,
          promoted: promotionOverride
            ? promotionOverride.override_value === 1
            : automaticallyPromoted,
        };
      }),
    });
    setOverrideReason('');
    setOverrideError('');
  }

  function moveOverrideRow(entryId: string, targetId: string) {
    setOverrideEditor((current) => {
      if (!current || entryId === targetId) return current;
      const rows = [...current.rows];
      const from = rows.findIndex((row) => row.id === entryId);
      const to = rows.findIndex((row) => row.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      return { ...current, rows };
    });
  }

  async function saveGroupOverridesFromEditor() {
    if (!overrideEditor) return;
    const reason = overrideReason.trim();
    if (!reason) {
      setOverrideError('Enter a reason for the group changes.');
      return;
    }
    setOverrideSaving(true);
    setOverrideError('');
    try {
      const existingForGroup = groupOverrides.filter(
        (item) =>
          item.category === overrideEditor.category && item.group_number === overrideEditor.group,
      );
      const originalOrder =
        groupStandings
          .find(
            (group) =>
              group.category === overrideEditor.category && group.group === overrideEditor.group,
          )
          ?.standings.map((row) => row.id) ?? [];
      const orderChanged = originalOrder.some((id, index) => overrideEditor.rows[index]?.id !== id);
      const writes: Array<{
        event_id: string;
        category: string;
        group_number: number;
        entry_id: string;
        override_type: 'ranking' | 'promotion';
        override_value: number;
        reason: string;
        updated_at: string;
      }> = [];
      const now = new Date().toISOString();
      if (orderChanged) {
        overrideEditor.rows.forEach((row, index) =>
          writes.push({
            event_id: eventId,
            category: overrideEditor.category,
            group_number: overrideEditor.group,
            entry_id: row.id,
            override_type: 'ranking',
            override_value: index + 1,
            reason,
            updated_at: now,
          }),
        );
      }
      for (const row of overrideEditor.rows) {
        const previous = existingForGroup.find(
          (item) => item.entry_id === row.id && item.override_type === 'promotion',
        );
        const previousStatus = previous
          ? previous.override_value === 1
          : (() => {
              const standings =
                groupStandings.find(
                  (group) =>
                    group.category === overrideEditor.category &&
                    group.group === overrideEditor.group,
                )?.standings ?? [];
              const index = standings.findIndex((standing) => standing.id === row.id);
              const promotionEnabled =
                format === 'team'
                  ? enabledPhases.team_round_robin !== false &&
                    enabledPhases.team_knockout !== false
                  : enabledPhases.round_robin !== false && enabledPhases.final_knockout !== false;
              return (
                standings.some((standing) => standing.played > 0) &&
                promotionEnabled &&
                index >= 0 &&
                index < Math.max(1, Number(config?.promoted_teams_per_group ?? 2))
              );
            })();
        if (row.promoted !== previousStatus)
          writes.push({
            event_id: eventId,
            category: overrideEditor.category,
            group_number: overrideEditor.group,
            entry_id: row.id,
            override_type: 'promotion',
            override_value: row.promoted ? 1 : 0,
            reason,
            updated_at: now,
          });
      }
      if (writes.length) {
        const { error } = await db
          .from('tournament_group_overrides')
          .upsert(writes, { onConflict: 'event_id,category,group_number,entry_id,override_type' });
        if (error) throw error;
      }
      const { data, error } = await db
        .from('tournament_group_overrides')
        .select('*')
        .eq('event_id', eventId);
      if (error) throw error;
      setGroupOverrides((data ?? []) as GroupOverride[]);
      setOverrideEditor(null);
      setOverrideReason('');
    } catch (error) {
      setOverrideError(error instanceof Error ? error.message : 'Could not save group standings.');
    } finally {
      setOverrideSaving(false);
    }
  }

  return {
    overrideEditor,
    setOverrideEditor,
    overrideReason,
    setOverrideReason,
    overrideSaving,
    overrideError,
    draggedEntryId,
    setDraggedEntryId,
    openGroupOverrideEditor,
    moveOverrideRow,
    saveGroupOverridesFromEditor,
  };
}
