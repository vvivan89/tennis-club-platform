import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { isValidElement, type ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  responses: {} as Record<string, unknown[]>,
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        maybeSingle: async () => ({
          data: mocks.responses[`${table}.maybeSingle`]?.shift() ?? null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.responses[`${table}.then`]?.shift() ?? [],
            error: null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/event-management-form', () => ({
  EventManagementForm: 'event-management-form',
}));
vi.mock('@/components/event-edit-management', () => ({
  EventEditManagement: 'event-edit-management',
}));

import CreateEventPage from '@/app/admin/events/create/page';
import EditEventPage from '@/app/admin/events/[slug]/edit/page';

const club = { club_name: 'Club', short_name: 'C', social_links: [] };
const event = {
  id: 'event-1',
  slug: 'spring-open',
  title: 'Spring Open',
  starts_at: '2027-06-01T12:00:00Z',
  created_by: 'creator-1',
  organizer_id: 'organizer-1',
};
function find(node: ReactNode, type: string): React.ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node))
    for (const child of node) {
      const result = find(child, type);
      if (result) return result;
    }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as React.ReactElement<Record<string, unknown>>;
  return find((node.props as { children?: React.ReactNode }).children, type);
}
beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.responses = {};
  mocks.redirect.mockClear();
  mocks.notFound.mockClear();
});

describe('admin event pages', () => {
  it('requires sign-in and event-management role for create', async () => {
    mocks.user = null;
    await expect(CreateEventPage()).rejects.toThrow('redirect:/login?next=/admin/events/create');
    mocks.user = { id: 'member-1' };
    mocks.responses['profiles.maybeSingle'] = [{ role: 'member' }];
    await expect(CreateEventPage()).rejects.toThrow('redirect:/member/dashboard');
  });

  it('passes current admin and organizer choices to the create form', async () => {
    mocks.responses['profiles.maybeSingle'] = [
      { role: 'admin', full_name: 'Alex', email: 'alex@example.com' },
      club,
    ];
    mocks.responses['profiles.then'] = [
      [
        { id: 'admin-1', full_name: 'Alex', email: 'alex@example.com', role: 'admin' },
        { id: 'organizer-1', full_name: 'Jordan', email: 'jordan@example.com', role: 'organizer' },
      ],
    ];
    const page = await CreateEventPage();
    const form = find(page, 'event-management-form');
    expect(form?.props.currentUserId).toBe('admin-1');
    expect(form?.props.showOrganizerField).toBe(true);
    expect(form?.props.organizerOptions).toHaveLength(2);
  });

  it('lets organizers create events without an administrator assignment field', async () => {
    mocks.responses['profiles.maybeSingle'] = [{ role: 'organizer' }];
    mocks.responses['club_settings.maybeSingle'] = [club];
    const page = await CreateEventPage();
    const form = find(page, 'event-management-form');
    expect(form?.props.currentUserId).toBe('admin-1');
    expect(form?.props.organizerOptions).toEqual([]);
    expect(form?.props.showOrganizerField).toBe(false);
  });

  it('restricts organizer edits to their assigned event and retains creator fallback', async () => {
    mocks.user = { id: 'other-organizer' };
    mocks.responses['profiles.maybeSingle'] = [{ role: 'organizer' }];
    mocks.responses['events.maybeSingle'] = [event];
    mocks.responses['club_settings.maybeSingle'] = [club];
    await expect(
      EditEventPage({ params: Promise.resolve({ slug: 'spring-open' }) }),
    ).rejects.toThrow('redirect:/admin/events');

    mocks.user = { id: 'creator-1' };
    mocks.responses['profiles.maybeSingle'] = [{ role: 'organizer' }];
    mocks.responses['events.maybeSingle'] = [{ ...event, organizer_id: null }];
    mocks.responses['club_settings.maybeSingle'] = [club];
    const page = await EditEventPage({ params: Promise.resolve({ slug: 'spring-open' }) });
    expect(find(page, 'event-management-form')?.props.showOrganizerField).toBe(false);
  });

  it('hides registration controls only for doubles and team tournament events', async () => {
    const renderEvent = async (eventOverrides: Record<string, unknown>) => {
      mocks.responses['profiles.maybeSingle'] = [{ role: 'admin' }, { role: 'admin' }];
      mocks.responses['events.maybeSingle'] = [{ ...event, ...eventOverrides }];
      mocks.responses['club_settings.maybeSingle'] = [club];
      mocks.responses['profiles.then'] = [[]];
      return EditEventPage({ params: Promise.resolve({ slug: 'spring-open' }) });
    };

    const doubles = await renderEvent({ event_type: 'tournament', tournament_format: 'doubles' });
    expect(find(doubles, 'event-edit-management')?.props.hideRegistrationManagement).toBe(true);

    const teams = await renderEvent({ event_type: 'tournament', tournament_format: 'team' });
    expect(find(teams, 'event-edit-management')?.props.hideRegistrationManagement).toBe(true);

    const singles = await renderEvent({ event_type: 'tournament', tournament_format: 'singles' });
    expect(find(singles, 'event-edit-management')?.props.hideRegistrationManagement).toBe(false);
    const social = await renderEvent({
      event_type: 'social_doubles',
      tournament_format: 'doubles',
    });
    expect(find(social, 'event-edit-management')?.props.hideRegistrationManagement).toBe(false);
  });

  it('resolves event aliases and redirects to the canonical edit URL', async () => {
    mocks.responses['profiles.maybeSingle'] = [{ role: 'admin' }];
    mocks.responses['events.maybeSingle'] = [null, event];
    mocks.responses['club_settings.maybeSingle'] = [club];
    mocks.responses['event_slug_aliases.maybeSingle'] = [{ event_id: event.id }];
    await expect(
      EditEventPage({ params: Promise.resolve({ slug: 'old-spring-slug' }) }),
    ).rejects.toThrow('redirect:/admin/events/spring-open/edit');
  });

  it('loads an event by legacy UUID and carries shared League configuration into the form', async () => {
    const legacyId = '11111111-1111-4111-8111-111111111111';
    mocks.responses['profiles.maybeSingle'] = [{ role: 'admin' }, null];
    mocks.responses['events.maybeSingle'] = [
      null,
      {
        ...event,
        id: legacyId,
        slug: null,
        created_by: null,
        social_doubles_ladder_id: 'league-1',
      },
    ];
    mocks.responses['club_settings.maybeSingle'] = [club];
    mocks.responses['social_doubles_ladders.maybeSingle'] = [
      {
        id: 'league-1',
        name: 'Summer League',
        competition_type: 'league',
        tournament_config: { categories: ['women'] },
        tournament_rules_html: '<p>League rules</p>',
        gender: 'female',
      },
    ];
    mocks.responses['profiles.then'] = [[]];

    const page = await EditEventPage({ params: Promise.resolve({ slug: legacyId }) });
    expect(find(page, 'event-management-form')?.props.event).toEqual(
      expect.objectContaining({
        id: legacyId,
        is_league_tournament: true,
        league_name: 'Summer League',
        ladder_gender: 'female',
        tournament_config: { categories: ['women'] },
        tournament_rules_html: '<p>League rules</p>',
      }),
    );
  });

  it('keeps ordinary event data and suppresses organizer choices for organizer-created events', async () => {
    mocks.responses['profiles.maybeSingle'] = [{ role: 'admin' }, { role: 'organizer' }];
    mocks.responses['events.maybeSingle'] = [{ ...event, created_by: 'organizer-1' }];
    mocks.responses['club_settings.maybeSingle'] = [club];
    const page = await EditEventPage({ params: Promise.resolve({ slug: event.slug }) });
    expect(find(page, 'event-management-form')?.props).toMatchObject({
      event: expect.objectContaining({ title: event.title }),
      organizerOptions: [],
      showOrganizerField: false,
    });
  });
});
