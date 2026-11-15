import { describe, expect, it } from 'vitest';
import {
  getEventTypeFormUpdate,
  initialEventFormValues,
  leagueTournamentConfig,
} from '@/components/event-form-defaults';

describe('event type form defaults', () => {
  it('keeps Social events and recurring behavior unchanged', () => {
    const result = getEventTypeFormUpdate('social', initialEventFormValues);
    expect(result.update).toMatchObject({ event_type: 'social' });
    expect(result.recurring).toBeUndefined();
    expect(result.seedSeries).toBe(false);
  });

  it('keeps doubles tournament configuration on tournament selection', () => {
    const result = getEventTypeFormUpdate('doubles_tournament', initialEventFormValues);
    expect(result.update).toMatchObject({
      event_type: 'tournament',
      tournament_format: 'doubles',
      members_only: false,
    });
    expect(result.recurring).toBe(false);
  });

  it('sets Party-only eligibility and single-event defaults', () => {
    const result = getEventTypeFormUpdate('party', {
      ...initialEventFormValues,
      gender_restriction: 'female',
      members_only: true,
      waitlist_enabled: true,
    });
    expect(result.update).toMatchObject({
      event_type: 'party',
      gender_restriction: null,
      members_only: false,
      waitlist_enabled: false,
    });
    expect(result.recurring).toBe(false);
    expect(result.seedSeries).toBe(false);
  });

  it('maps a Mixed League to the mixed doubles registration category', () => {
    expect(leagueTournamentConfig(initialEventFormValues.tournament_config, 'mixed')).toMatchObject(
      {
        categories: ['mixed'],
        phases: { round_robin: true },
        registration_mode: 'both',
      },
    );
  });

  it('preserves optional skill bounds when switching to League configuration', () => {
    const result = getEventTypeFormUpdate('league_tournament', {
      ...initialEventFormValues,
      minimum_tennis_skill_level: '3.0',
      maximum_tennis_skill_level: '4.5',
    });
    expect(result.update.tournament_config).toMatchObject({
      minimum_tennis_skill_level: 3,
      maximum_tennis_skill_level: 4.5,
    });
  });
});
