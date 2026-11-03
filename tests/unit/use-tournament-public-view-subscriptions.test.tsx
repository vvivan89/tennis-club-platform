import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTournamentPublicViewSubscriptions } from '@/components/use-tournament-public-view-subscriptions';

describe('useTournamentPublicViewSubscriptions', () => {
  it('subscribes to event data, refreshes relevant state, handles custom events, and cleans up', () => {
    const handlers: Array<{ filter: Record<string, string>; callback: () => void }> = [];
    const channel = {
      on: vi.fn((_event: string, filter: Record<string, string>, callback: () => void) => {
        handlers.push({ filter, callback });
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const dbMock = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };
    const db = dbMock as unknown as SupabaseClient;
    const setActiveCategory = vi.fn();
    const setRegistrationRefresh = vi.fn((update: SetStateAction<number>) =>
      typeof update === 'function' ? update(4) : update,
    );
    const refreshPage = vi.fn();
    const { unmount } = renderHook(() =>
      useTournamentPublicViewSubscriptions({
        db,
        eventId: 'event-7',
        setActiveCategory,
        setRegistrationRefresh,
        refreshPage,
      }),
    );

    expect(dbMock.channel).toHaveBeenCalledWith('tournament-public-event-7');
    expect(channel.on).toHaveBeenCalledTimes(7);
    expect(channel.subscribe).toHaveBeenCalledOnce();
    expect(handlers.map(({ filter }) => filter.table)).toEqual([
      'events',
      'tournament_teams',
      'tournament_participants',
      'tournament_pairs',
      'league_event_court_assignments',
      'tournament_matches',
      'tournament_match_players',
    ]);

    act(() => {
      handlers[0].callback();
      handlers.slice(1).forEach(({ callback }) => callback());
    });
    expect(refreshPage).toHaveBeenCalledOnce();
    expect(setRegistrationRefresh).toHaveBeenCalledTimes(6);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pctc-tournament-category-change', { detail: { category: 'women' } }),
      );
      window.dispatchEvent(new CustomEvent('pctc-tournament-category-change', { detail: {} }));
      window.dispatchEvent(
        new CustomEvent('pctc-tournament-data-refresh', { detail: { eventId: 'event-other' } }),
      );
      window.dispatchEvent(
        new CustomEvent('pctc-tournament-data-refresh', { detail: { eventId: 'event-7' } }),
      );
      window.dispatchEvent(new CustomEvent('pctc-tournament-data-refresh', { detail: {} }));
    });
    expect(setActiveCategory).toHaveBeenCalledOnce();
    expect(setActiveCategory).toHaveBeenCalledWith('women');
    expect(setRegistrationRefresh).toHaveBeenCalledTimes(8);

    unmount();
    expect(dbMock.removeChannel).toHaveBeenCalledWith(channel);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('pctc-tournament-category-change', { detail: { category: 'men' } }),
      );
      window.dispatchEvent(
        new CustomEvent('pctc-tournament-data-refresh', { detail: { eventId: 'event-7' } }),
      );
    });
    expect(setActiveCategory).toHaveBeenCalledOnce();
    expect(setRegistrationRefresh).toHaveBeenCalledTimes(8);
  });
});
