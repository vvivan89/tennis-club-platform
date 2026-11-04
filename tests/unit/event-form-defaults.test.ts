import { describe, expect, it } from 'vitest';
import { getEventTypeFormUpdate, initialEventFormValues } from '@/components/event-form-defaults';

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
});
