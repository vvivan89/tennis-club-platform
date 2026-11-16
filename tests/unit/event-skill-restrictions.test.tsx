import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventSkillRestrictions } from '@/components/event-skill-restrictions';
import { initialEventFormValues } from '@/components/event-form-defaults';

describe('event skill restriction controls', () => {
  it.each([
    ['doubles tournament', { event_type: 'tournament', tournament_format: 'doubles' }],
    ['League', { event_type: 'tournament', is_league_tournament: true }],
    ['social doubles Ladder', { event_type: 'social_doubles_ladder' }],
  ])('shows the optional skill range for %s', (_label, overrides) => {
    render(
      <EventSkillRestrictions
        values={{
          ...initialEventFormValues,
          minimum_tennis_skill_level: '3.0',
          maximum_tennis_skill_level: '4.5',
          ...overrides,
        }}
        change={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Minimum skill level')).toHaveValue('3.0');
    expect(screen.getByLabelText('Maximum skill level')).toHaveValue('4.5');
  });

  it('does not show skill controls for team tournaments', () => {
    const { container } = render(
      <EventSkillRestrictions
        values={{ ...initialEventFormValues, event_type: 'tournament', tournament_format: 'team' }}
        change={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
