import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EventBasicsFields } from '@/components/event-basics-fields';
import type { EventFormValues } from '@/components/event-form-types';

function values(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    title: 'Club event',
    description: 'Details',
    gender_restriction: null,
    event_type: 'social',
    starts_at: '',
    ends_at: '',
    registration_opens_at: '',
    registration_closes_at: '',
    capacity: 24,
    price_cents: 0,
    members_only: false,
    status: 'draft',
    location: 'Club courts',
    notes: '',
    waitlist_enabled: false,
    court_count: 2,
    tournament_format: null,
    tournament_config: {},
    tournament_rules_html: '',
    allow_non_member_registration: false,
    tournament_details_public: false,
    ladder_gender: 'male',
    ladder_points: [10, 6, 3, 1],
    ladder_ranking_priority: [],
    ladder_carryover: 'none',
    ladder_previous_id: '',
    ladder_existing_id: '',
    ladder_name: '',
    league_existing_id: '',
    is_league_tournament: false,
    ...overrides,
  };
}

describe('EventBasicsFields', () => {
  it('shows social event fields and reports controlled field changes', () => {
    const change = vi.fn();
    const onEventTypeChange = vi.fn();
    render(
      <EventBasicsFields
        v={values()}
        change={change}
        showOrganizerField
        currentUserId="admin-1"
        organizerOptions={[
          { id: 'admin-1', full_name: 'Admin', email: 'admin@example.test', role: 'admin' },
        ]}
        onEventTypeChange={onEventTypeChange}
      />,
    );
    expect(screen.getByLabelText('Organizer')).toHaveValue('admin-1');
    expect(screen.getByLabelText('Participant gender restriction (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Active paid membership required')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum attendees')).toBeRequired();

    fireEvent.change(screen.getByLabelText('Event type'), { target: { value: 'team_tournament' } });
    fireEvent.change(screen.getByLabelText('Participant gender restriction (optional)'), {
      target: { value: 'female' },
    });
    expect(onEventTypeChange).toHaveBeenCalledWith('team_tournament');
    expect(change).toHaveBeenCalledWith('gender_restriction', 'female');
  });

  it('hides social-only inputs and allows an unlimited non-League tournament capacity', () => {
    render(
      <EventBasicsFields
        v={values({
          event_type: 'tournament',
          tournament_format: 'doubles',
          capacity: 1_000_000,
        })}
        change={vi.fn()}
        showOrganizerField={false}
        currentUserId="organizer-1"
        organizerOptions={[]}
        onEventTypeChange={vi.fn()}
      />,
    );
    const capacity = screen.getByLabelText('Total tournament capacity (optional)');
    expect(capacity).not.toBeRequired();
    expect(capacity).toHaveAttribute('placeholder', 'Unlimited');
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Active paid membership required')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Organizer')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Event type')).toHaveValue('doubles_tournament');
  });

  it('shows the League description and required attendee limit, and maps ladder event type', () => {
    const change = vi.fn();
    const onEventTypeChange = vi.fn();
    const { rerender } = render(
      <EventBasicsFields
        v={values({ event_type: 'tournament', is_league_tournament: true })}
        change={change}
        showOrganizerField={false}
        currentUserId="organizer-1"
        organizerOptions={[]}
        onEventTypeChange={onEventTypeChange}
      />,
    );
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum attendees')).toBeRequired();
    expect(screen.getByLabelText('Event type')).toHaveValue('league_tournament');

    rerender(
      <EventBasicsFields
        v={values({ event_type: 'social_doubles_ladder' })}
        change={change}
        showOrganizerField={false}
        currentUserId="organizer-1"
        organizerOptions={[]}
        onEventTypeChange={onEventTypeChange}
      />,
    );
    expect(screen.getByLabelText('Event type')).toHaveValue('social_doubles_ladder');
    expect(
      screen.queryByLabelText('Participant gender restriction (optional)'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Event type'), { target: { value: 'social' } });
    expect(onEventTypeChange).toHaveBeenCalledWith('social');
  });
});
