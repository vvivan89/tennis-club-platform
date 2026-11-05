import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const tiptapMocks = vi.hoisted(() => ({
  options: null as null | { onUpdate?: (payload: { editor: { getHTML: () => string } }) => void },
}));

const supabaseMocks = vi.hoisted(() => ({
  fromCalls: [] as string[],
  rpcCalls: [] as string[],
  data: {} as Record<string, unknown>,
  errors: {} as Record<string, { message: string }>,
  rpcData: {} as Record<string, unknown>,
  rpcErrors: {} as Record<string, { message: string }>,
  rpcArgs: [] as Array<{ name: string; args: unknown }>,
  writes: [] as Array<{ table: string; operation: string; values?: unknown }>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));
vi.mock('@/components/event-weather', () => ({
  EventWeather: () => <div data-testid="event-weather" />,
}));

vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    channel: () => {
      const channel: Record<string, unknown> = {};
      channel.on = () => channel;
      channel.subscribe = () => channel;
      return channel;
    },
    removeChannel: async () => ({}),
    rpc: async (name: string, args: unknown) => {
      supabaseMocks.rpcCalls.push(name);
      supabaseMocks.rpcArgs.push({ name, args });
      return {
        data: supabaseMocks.rpcData[name] ?? [],
        error: supabaseMocks.rpcErrors[name] ?? null,
      };
    },
    from: (table: string) => {
      supabaseMocks.fromCalls.push(table);
      let operation = 'select';
      let values: unknown;
      const result = () => ({
        data:
          operation === 'insert'
            ? Object.hasOwn(supabaseMocks.data, `${table}.insert`)
              ? supabaseMocks.data[`${table}.insert`]
              : []
            : Object.hasOwn(supabaseMocks.data, table)
              ? supabaseMocks.data[table]
              : [],
        error: supabaseMocks.errors[`${table}.${operation}`] ?? supabaseMocks.errors[table] ?? null,
      });
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'in', 'or', 'order', 'limit']) {
        query[method] = () => query;
      }
      query.insert = (nextValues: unknown) => {
        operation = 'insert';
        values = nextValues;
        supabaseMocks.writes.push({ table, operation, values });
        return query;
      };
      query.update = (nextValues: unknown) => {
        operation = 'update';
        values = nextValues;
        supabaseMocks.writes.push({ table, operation, values });
        return query;
      };
      query.delete = () => {
        operation = 'delete';
        supabaseMocks.writes.push({ table, operation });
        return query;
      };
      query.upsert = (nextValues: unknown) => {
        operation = 'upsert';
        values = nextValues;
        supabaseMocks.writes.push({ table, operation, values });
        return query;
      };
      query.maybeSingle = async () => {
        const value = result();
        return {
          ...value,
          error: supabaseMocks.errors[`${table}.maybeSingle`] ?? value.error,
          data: Array.isArray(value.data) ? (value.data[0] ?? null) : value.data,
        };
      };
      query.single = async () => result();
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject);
      return query;
    },
  }),
}));

vi.mock('@tiptap/react', () => ({
  useEditor: (options: typeof tiptapMocks.options) => {
    tiptapMocks.options = options;
    return {
      getHTML: () => '<p>Rules</p>',
      commands: { setContent: vi.fn() },
      chain: () => ({
        focus: () => ({
          toggleBold: () => ({ run: vi.fn() }),
          toggleItalic: () => ({ run: vi.fn() }),
          toggleUnderline: () => ({ run: vi.fn() }),
          toggleHeading: () => ({ run: vi.fn() }),
          toggleBulletList: () => ({ run: vi.fn() }),
          toggleOrderedList: () => ({ run: vi.fn() }),
        }),
      }),
      isActive: () => false,
    };
  },
  EditorContent: () => <div data-testid="editor-content" />,
}));
vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));

import { TournamentManagement } from '@/components/tournament-management';
import { TournamentPublicView } from '@/components/tournament-public-view';
import { PublicOrganizerContacts } from '@/components/public-organizer-contacts';
import { dateLabel } from '@/components/tournament-public-view-format';
import { eventPriceLabel } from '@/lib/event-format';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  tiptapMocks.options = null;
  supabaseMocks.fromCalls = [];
  supabaseMocks.rpcCalls = [];
  supabaseMocks.data = {};
  supabaseMocks.errors = {};
  supabaseMocks.rpcData = {};
  supabaseMocks.rpcErrors = {};
  supabaseMocks.rpcArgs = [];
  supabaseMocks.writes = [];
  vi.clearAllMocks();
});

describe('tournament component coverage', () => {
  it('surfaces initial tournament workspace query failures', async () => {
    supabaseMocks.errors['tournament_teams'] = { message: 'Could not load tournament teams.' };
    render(
      <TournamentManagement
        eventId="event-query-error"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tournament teams.');
  });

  describe('public tournament contact and registration workflows', () => {
    it('lets managers review winners before announcing them and removes the public announcement when unannounced', async () => {
      supabaseMocks.data.tournament_public_pairs = [
        {
          id: 'pair-a',
          event_id: 'winner-event',
          category: 'mixed',
          player_one_id: 'a1',
          player_two_id: 'a2',
          group_number: 1,
          seed: null,
          status: 'active',
          player_one_name: 'Alex Player',
          player_two_name: 'Jordan Player',
        },
        {
          id: 'pair-b',
          event_id: 'winner-event',
          category: 'mixed',
          player_one_id: 'b1',
          player_two_id: 'b2',
          group_number: 1,
          seed: null,
          status: 'active',
          player_one_name: 'Taylor Player',
          player_two_name: 'Casey Player',
        },
      ];
      supabaseMocks.data.tournament_public_matches = [
        {
          id: 'completed-match',
          event_id: 'winner-event',
          category: 'mixed',
          phase: 'round_robin',
          group_number: 1,
          round_number: 1,
          match_number: 1,
          pair_one_id: 'pair-a',
          pair_two_id: 'pair-b',
          team_one_id: null,
          team_two_id: null,
          scheduled_at: '2026-11-01T12:00:00Z',
          court_number: 1,
          score_sets: [{ one: 6, two: 2 }],
          winner_side: 1,
          team_points_one: 0,
          team_points_two: 0,
          status: 'completed',
        },
      ];
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="winner-event"
          currentUserId={null}
          isManager
          format="doubles"
          config={{
            categories: ['mixed'],
            phases: { round_robin: true, final_knockout: false },
          }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration={false}
          eventStatus="published"
          startsAt="2026-11-01T12:00:00Z"
          endsAt={null}
          locationQuery="PCTC courts"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt={null}
          priceCents={0}
        />,
      );

      const announce = await screen.findByRole('button', { name: 'Announce winners' });
      expect(screen.queryByRole('region', { name: 'Tournament winners' })).not.toBeInTheDocument();
      const preview = screen.getByRole('list', { name: 'Winner preview' });
      expect(preview).toHaveTextContent('Mixed doubles');
      expect(preview).toHaveTextContent('Alex Player + Jordan Player');

      await user.click(announce);
      expect(await screen.findByText('Alex Player + Jordan Player')).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Announced winners' })).toHaveTextContent(
        'Mixed doubles',
      );
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'events',
          operation: 'update',
          values: expect.objectContaining({
            tournament_winners_announced: true,
            tournament_winners: [{ category: 'mixed', winners: ['Alex Player + Jordan Player'] }],
          }),
        }),
      );

      await user.click(screen.getByRole('button', { name: 'Unannounce winners' }));
      await waitFor(() =>
        expect(screen.queryByRole('list', { name: 'Announced winners' })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('list', { name: 'Winner preview' })).toHaveTextContent(
        'Alex Player + Jordan Player',
      );
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'events',
          operation: 'update',
          values: expect.objectContaining({
            tournament_winners_announced: false,
            tournament_winners: [],
          }),
        }),
      );
    });

    it('announces team standings winners for the completed single-group tournament flow', async () => {
      supabaseMocks.data.tournament_public_teams = [
        {
          id: 'team-a',
          name: 'Court Chaos',
          logo_url: null,
          color: '',
          group_number: null,
          captain_user_id: 'captain-a',
          captain_name: 'Alex Player',
        },
        {
          id: 'team-b',
          name: 'Team 2',
          logo_url: null,
          color: '',
          group_number: null,
          captain_user_id: 'captain-b',
          captain_name: 'Taylor Player',
        },
      ];
      supabaseMocks.data.tournament_public_matches = [
        {
          id: 'team-match',
          event_id: 'team-winner-event',
          category: 'men',
          phase: 'team_round_robin',
          group_number: null,
          round_number: 1,
          match_number: 1,
          pair_one_id: null,
          pair_two_id: null,
          team_one_id: 'team-a',
          team_two_id: 'team-b',
          team_one_name: 'Court Chaos',
          team_two_name: 'Team 2',
          scheduled_at: '2026-11-03T23:30:00Z',
          court_number: 1,
          score_sets: [
            { one: 6, two: 3 },
            { one: 2, two: 6 },
            { one: 7, two: 6 },
          ],
          winner_side: 1,
          team_points_one: 2,
          team_points_two: 1,
          status: 'completed',
        },
      ];
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="team-winner-event"
          currentUserId={null}
          isManager
          format="team"
          config={{
            categories: ['mixed', 'men', 'women'],
            phases: { team_round_robin: true, team_knockout: false },
            group_count: 1,
            ranking_priority: ['points', 'matches_won', 'sets_won', 'games_won'],
            scoring_templates: { team_round_robin: 'team_two_sets_bonus_third' },
          }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration={false}
          eventStatus="published"
          startsAt="2026-11-03T20:00:00Z"
          endsAt={null}
          locationQuery="PCTC courts"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt={null}
          priceCents={0}
        />,
      );

      const preview = await screen.findByRole('list', { name: 'Winner preview' });
      expect(preview).toHaveTextContent("Men's teams");
      expect(preview).toHaveTextContent('Court Chaos');
      await user.click(await screen.findByRole('button', { name: 'Announce winners' }));
      const winners = await screen.findByRole('list', { name: 'Announced winners' });
      expect(winners).toHaveTextContent("Men's teams");
      expect(winners).toHaveTextContent('Court Chaos');
    });

    it('keeps cost, event dates, and registration window public when tournament details are hidden', () => {
      const startsAt = '2027-06-01T18:00:00.000Z';
      const endsAt = '2027-06-01T21:00:00.000Z';
      const opensAt = '2027-05-01T18:00:00.000Z';
      const closesAt = '2027-05-31T18:00:00.000Z';
      render(
        <TournamentPublicView
          eventTitle="Private details tournament"
          eventId="private-details-tournament"
          currentUserId={null}
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'both' }}
          rulesHtml={null}
          detailsPublic={false}
          allowNonMemberRegistration={false}
          eventStatus="published"
          startsAt={startsAt}
          endsAt={endsAt}
          locationQuery="PCTC courts"
          registrationOpensAt={opensAt}
          registrationClosesAt={closesAt}
          priceCents={2500}
        />,
      );

      expect(screen.getByText(eventPriceLabel(2500, false))).toBeInTheDocument();
      expect(screen.getByText(`${dateLabel(startsAt)} – ${dateLabel(endsAt)}`)).toBeInTheDocument();
      expect(screen.getByText(`Opens: ${dateLabel(opensAt)}`)).toBeInTheDocument();
      expect(screen.getByText(`Closes: ${dateLabel(closesAt)}`)).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Participants' })).not.toBeInTheDocument();
    });

    it('lets approved members view unpublished team tournament details before registering', async () => {
      render(
        <TournamentPublicView
          eventId="member-team-tournament"
          currentUserId="approved-member"
          currentUserIsApprovedMember
          format="team"
          config={{ categories: ['open'], phases: { round_robin: true } }}
          rulesHtml={null}
          detailsPublic={false}
          allowNonMemberRegistration={false}
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery="PCTC courts"
          registrationOpensAt="2027-01-01T00:00:00Z"
          registrationClosesAt="2027-05-31T23:00:00Z"
          priceCents={0}
        />,
      );

      expect(
        await screen.findByRole('tab', { name: /Groups, Schedule & Results/i }),
      ).toBeInTheDocument();
      await waitFor(() => expect(supabaseMocks.fromCalls).toContain('tournament_public_teams'));
    });

    it('loads public organizer contacts once and renders only the supplied contact details', async () => {
      supabaseMocks.rpcData.event_public_tournament_organizer_contact_details = [
        {
          organizer_id: 'organizer-1',
          organizer_name: 'Alex Organizer',
          position: 'Tournament director',
          emails: ['alex@example.com'],
          phones: ['604-555-0100'],
        },
      ];
      const user = userEvent.setup();
      render(
        <PublicOrganizerContacts eventId="event-contact" organizerNames={['Alex Organizer']} />,
      );

      expect(screen.getByText('Alex Organizer')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show contacts' }));
      expect(await screen.findByText('Tournament director')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'alex@example.com' })).toHaveAttribute(
        'href',
        'mailto:alex@example.com',
      );
      expect(screen.getByRole('link', { name: '604-555-0100' })).toHaveAttribute(
        'href',
        'tel:604-555-0100',
      );
      await user.click(screen.getByRole('button', { name: 'Close organizer contacts' }));
      await user.click(screen.getByRole('button', { name: 'Show contacts' }));
      expect(
        supabaseMocks.rpcCalls.filter(
          (name) => name === 'event_public_tournament_organizer_contact_details',
        ),
      ).toHaveLength(1);
    });

    it('shows no-contact and RPC error states', async () => {
      supabaseMocks.rpcData.event_public_tournament_organizer_contact_details = [];
      const user = userEvent.setup();
      const { unmount } = render(
        <PublicOrganizerContacts eventId="event-empty" organizerNames={[]} />,
      );
      expect(screen.getByText('Organizer information')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show contacts' }));
      expect(
        await screen.findByText('No public contact information is available.'),
      ).toBeInTheDocument();

      unmount();
      supabaseMocks.rpcErrors.event_public_tournament_organizer_contact_details = {
        message: 'private database error',
      };
      render(<PublicOrganizerContacts eventId="event-error" organizerNames={[]} />);
      await user.click(screen.getByRole('button', { name: 'Show contacts' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Organizer contacts could not be loaded. Please try again later.',
      );
    });

    it('registers a free anonymous entrant with optional gender and skill data', async () => {
      supabaseMocks.rpcData.register_event_guest_tournament_entry = {
        participantId: 'guest-entry-1',
        amountCents: 0,
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-guest"
          currentUserId="guest-session-user"
          currentUserAccountKind="event_guest"
          currentUserEmail="taylor@example.com"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'single' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery="Port Coquitlam, BC"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt="2027-05-31T23:00:00Z"
          priceCents={0}
        />,
      );

      await screen.findByRole('tab', { name: 'Overview' });
      await user.type(screen.getByLabelText('Your full name'), 'Taylor Guest');
      await user.selectOptions(screen.getByLabelText('Gender (optional)'), 'female');
      await user.selectOptions(screen.getByLabelText('Tennis skill level (optional)'), '4.0');
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

      expect(await screen.findByText('Registration confirmed.')).toBeInTheDocument();
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'register_event_guest_tournament_entry',
        args: expect.objectContaining({
          p_event_id: 'event-guest',
          p_category: 'mixed',
          p_display_name: 'Taylor Guest',
          p_gender: 'female',
          p_tennis_skill_level: 4,
        }),
      });
    });

    it('submits a single guest registration with optional profile fields omitted', async () => {
      supabaseMocks.rpcData.register_event_guest_tournament_entry = {
        participantId: 'guest-entry-no-profile',
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-guest-no-profile"
          currentUserId="guest-session-user"
          currentUserAccountKind="event_guest"
          currentUserEmail="guest@example.test"
          format="singles"
          config={{ categories: ['mixed'], registration_mode: 'individual' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt={null}
          locationQuery=""
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt={null}
          priceCents={0}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      await user.type(screen.getByLabelText('Your full name'), 'Guest Player');
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

      expect(await screen.findByText('Registration confirmed.')).toBeInTheDocument();
      expect(supabaseMocks.rpcArgs).toContainEqual(
        expect.objectContaining({
          name: 'register_event_guest_tournament_entry',
          args: expect.objectContaining({
            p_display_name: 'Guest Player',
            p_gender: null,
            p_tennis_skill_level: null,
          }),
        }),
      );
    });

    it('registers a guest pair when optional partner fields are blank', async () => {
      supabaseMocks.rpcData.register_event_guest_tournament_entry = {
        participantId: 'guest-entry-2',
        partnerParticipantId: 'guest-partner-2',
        amountCents: 2500,
        paymentStatus: 'pending',
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-guest-pair"
          currentUserId="guest-session-user"
          currentUserAccountKind="event_guest"
          currentUserEmail="taylor@example.com"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'doubles' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery="Port Coquitlam, BC"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt="2027-05-31T23:00:00Z"
          priceCents={1250}
        />,
      );

      await screen.findByRole('tab', { name: 'Overview' });
      await user.type(screen.getByLabelText('Your full name'), 'Taylor Guest');
      await user.type(screen.getByLabelText('Partner name'), 'Morgan Guest');
      await user.type(screen.getByLabelText('Partner email'), 'morgan@example.com');
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Registration saved. Your team can pay after your partner confirms.',
      );
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'register_event_guest_tournament_entry',
        args: expect.objectContaining({
          p_display_name: 'Taylor Guest',
          p_partner_name: 'Morgan Guest',
          p_partner_email: 'morgan@example.com',
          p_partner_phone: null,
          p_partner_gender: null,
          p_partner_skill_level: null,
        }),
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/events/partner-invitations',
        expect.objectContaining({
          body: JSON.stringify({ participantIds: ['guest-partner-2'] }),
        }),
      );
    });

    it('requires both name and email before registering with a newly entered partner', async () => {
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-partner-required-fields"
          currentUserId="member-1"
          currentUserGender="male"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'both' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt={null}
          locationQuery=""
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt={null}
          priceCents={0}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      await user.selectOptions(screen.getByLabelText('Registration type'), 'pair');
      await user.click(screen.getByPlaceholderText('Search members by name'));
      await user.click(screen.getByRole('option', { name: /Add a partner without an account/ }));
      await user.type(screen.getByLabelText('Partner name'), 'New Partner');
      fireEvent.submit(
        screen.getByRole('button', { name: 'Register for tournament' }).closest('form')!,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Enter your partner’s name and email.',
      );
      expect(supabaseMocks.rpcCalls).not.toContain('register_tournament_entry');
    });

    it('rejects a newly entered partner whose gender is ineligible for the selected category', async () => {
      const category = 'men';
      const partnerGender = 'female';
      const message = "The partner's gender is not eligible for Men's doubles.";
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId={`event-partner-gender-${category}`}
          currentUserId="member-1"
          currentUserGender="male"
          format="doubles"
          config={{ categories: [category], registration_mode: 'both' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt={null}
          locationQuery=""
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt={null}
          priceCents={0}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      await user.selectOptions(screen.getByLabelText('Registration type'), 'pair');
      await user.click(screen.getByPlaceholderText('Search members by name'));
      await user.click(screen.getByRole('option', { name: /Add a partner without an account/ }));
      await user.type(screen.getByLabelText('Partner name'), 'Morgan New');
      await user.type(screen.getByLabelText('Partner email'), 'morgan@example.test');
      await user.selectOptions(screen.getByLabelText('Partner gender (optional)'), partnerGender);
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(supabaseMocks.rpcCalls).not.toContain('register_tournament_entry');
    });

    it('disables a same-gender member partner for mixed doubles', async () => {
      supabaseMocks.data.profiles = { gender: 'male' };
      supabaseMocks.rpcData.event_tournament_partner_directory = [
        { id: 'same-gender-partner', full_name: 'Morgan Member', gender: 'male' },
      ];
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-gender-validation"
          currentUserId="member-1"
          currentUserGender="male"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'doubles' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery="Port Coquitlam, BC"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt="2027-05-31T23:00:00Z"
          priceCents={1500}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      await user.click(screen.getByPlaceholderText('Search members by name'));
      expect(screen.getByRole('option', { name: /Morgan Member/ })).toBeDisabled();
      expect(
        screen.getByText('Mixed doubles requires different known genders'),
      ).toBeInTheDocument();
      expect(supabaseMocks.rpcCalls).not.toContain('register_tournament_entry');
    });

    it('requires a partner for signed-in pair registrations and submits the selected member partner', async () => {
      supabaseMocks.data.profiles = { gender: 'male' };
      supabaseMocks.rpcData.event_tournament_partner_directory = [
        { id: 'partner-user', full_name: 'Jordan Partner', gender: 'female' },
      ];
      supabaseMocks.rpcData.register_tournament_entry = {
        participantId: 'member-entry',
        partnerParticipantId: 'partner-entry',
        amountCents: 0,
        paymentStatus: 'not_required',
      };
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-member-registration"
          currentUserId="member-1"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'doubles' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery="Port Coquitlam, BC"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt="2027-05-31T23:00:00Z"
          priceCents={0}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));
      expect(
        await screen.findByText('Choose a registered partner or enter new partner details.'),
      ).toBeInTheDocument();

      await user.click(screen.getByPlaceholderText('Search members by name'));
      await user.click(screen.getByRole('option', { name: /Jordan Partner/ }));
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Registration confirmed. The entry is saved',
      );
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'register_tournament_entry',
        args: expect.objectContaining({
          p_event_id: 'event-member-registration',
          p_partner_user_id: 'partner-user',
        }),
      });
    });

    it.each([
      [{ participantId: 'single-free-entry', amountCents: 0 }, 'Registration confirmed.'],
      [
        { participantId: 'single-prepaid-entry', amountCents: 1500, paymentStatus: 'paid' },
        'Your previous non-refunded payment was applied to this category.',
      ],
    ])(
      'registers a signed-in singles entrant and reports the returned payment state',
      async (result, message) => {
        supabaseMocks.rpcData.register_tournament_entry = result;
        const user = userEvent.setup();
        render(
          <TournamentPublicView
            eventId="event-member-singles"
            currentUserId="member-1"
            currentUserGender="male"
            format="singles"
            config={{ categories: ['men'], registration_mode: 'individual' }}
            rulesHtml={null}
            detailsPublic
            allowNonMemberRegistration={false}
            eventStatus="published"
            startsAt="2027-06-01T12:00:00Z"
            endsAt={null}
            locationQuery=""
            registrationOpensAt="2026-01-01T00:00:00Z"
            registrationClosesAt={null}
            priceCents={1500}
          />,
        );
        await screen.findByRole('tab', { name: 'Overview' });
        await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

        expect(await screen.findByRole('status')).toHaveTextContent(message);
        expect(supabaseMocks.rpcArgs).toContainEqual(
          expect.objectContaining({
            name: 'register_tournament_entry',
            args: expect.objectContaining({
              p_event_id: 'event-member-singles',
              p_category: 'men',
            }),
          }),
        );
      },
    );

    it('requires the guest display name and verified email before registration', async () => {
      render(
        <TournamentPublicView
          eventId="event-guest-identity-required"
          currentUserId="guest-session-user"
          currentUserAccountKind="event_guest"
          format="singles"
          config={{ categories: ['men'], registration_mode: 'individual' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt={null}
          locationQuery=""
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt={null}
          priceCents={0}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      fireEvent.submit(
        screen.getByRole('button', { name: 'Register for tournament' }).closest('form')!,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Enter your name to continue. Your verified email is required.',
      );
      expect(supabaseMocks.rpcCalls).not.toContain('register_event_guest_tournament_entry');
    });

    it('registers with a new partner and sends their confirmation invitation', async () => {
      supabaseMocks.data.profiles = { gender: 'male' };
      supabaseMocks.rpcData.register_tournament_entry = {
        participantId: 'member-entry-new-partner',
        partnerParticipantId: 'guest-partner-entry',
        partnerEmail: 'jordan@example.com',
        amountCents: 3000,
        paymentStatus: 'pending',
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-member-new-partner"
          currentUserId="member-1"
          currentUserGender="male"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'both' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery="Port Coquitlam, BC"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt="2027-05-31T23:00:00Z"
          priceCents={1500}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      await user.selectOptions(screen.getByLabelText('Registration type'), 'pair');
      await user.click(screen.getByPlaceholderText('Search members by name'));
      await user.click(screen.getByRole('option', { name: /Add a partner without an account/ }));
      await user.type(screen.getByLabelText('Partner name'), 'Jordan Guest');
      await user.type(screen.getByLabelText('Partner email'), 'jordan@example.com');
      await user.type(screen.getByLabelText('Partner phone (optional)'), '604-555-0102');
      await user.selectOptions(screen.getByLabelText('Partner gender (optional)'), 'female');
      await user.selectOptions(
        screen.getByLabelText('Partner tennis skill level (optional)'),
        '4.0',
      );
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        'A non-member partner will receive a sign-in link.',
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/events/partner-invitations',
        expect.objectContaining({
          body: JSON.stringify({ participantIds: ['guest-partner-entry'] }),
        }),
      );
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'register_tournament_entry',
        args: expect.objectContaining({
          p_partner_name: 'Jordan Guest',
          p_partner_email: 'jordan@example.com',
          p_partner_phone: '604-555-0102',
          p_partner_gender: 'female',
          p_partner_tennis_skill_level: 4,
          p_partner_user_id: null,
        }),
      });
    });

    it('keeps a member registration and reports a failed partner confirmation email', async () => {
      supabaseMocks.data.profiles = { gender: 'male' };
      supabaseMocks.rpcData.register_tournament_entry = {
        participantId: 'saved-member-entry',
        partnerParticipantId: 'saved-partner-entry',
        partnerEmail: 'partner@example.com',
        amountCents: 0,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: 'Mail delivery failed.' }),
        }),
      );
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-partner-mail-failure"
          currentUserId="member-1"
          currentUserGender="male"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'both' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery=""
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt={null}
          priceCents={0}
        />,
      );
      await screen.findByRole('tab', { name: 'Overview' });
      await user.selectOptions(screen.getByLabelText('Registration type'), 'pair');
      await user.click(screen.getByPlaceholderText('Search members by name'));
      await user.click(screen.getByRole('option', { name: /Add a partner without an account/ }));
      await user.type(screen.getByLabelText('Partner name'), 'Jordan Partner');
      await user.type(screen.getByLabelText('Partner email'), 'partner@example.com');
      await user.selectOptions(screen.getByLabelText('Partner gender (optional)'), 'female');
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        'The entry is saved, but the partner confirmation email could not be sent: Mail delivery failed.',
      );
      expect(supabaseMocks.rpcCalls).toContain('register_tournament_entry');
    });

    it('loads and confirms a partner invitation addressed to the signed-in member', async () => {
      window.history.replaceState({}, '', '/events/pairs?confirm_partner=invitee-entry');
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/events/partner-confirmation?')) {
          return {
            ok: true,
            json: async () => ({
              participant: {
                displayName: 'Taylor Invitee',
                email: 'taylor@example.com',
                phone: null,
                gender: 'female',
                tennisSkillLevel: 3.5,
              },
              event: { title: 'Mixed Doubles' },
              invitedBy: 'Alex Member',
            }),
          } as Response;
        }
        if (url === '/api/events/partner-confirmation' && init?.method === 'POST') {
          return { ok: true, json: async () => ({ success: true }) } as Response;
        }
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="partner-confirm-event"
          currentUserId="member-invited"
          format="doubles"
          config={{ categories: ['mixed'], registration_mode: 'doubles' }}
          rulesHtml={null}
          detailsPublic
          allowNonMemberRegistration
          eventStatus="published"
          startsAt="2027-06-01T12:00:00Z"
          endsAt="2027-06-01T20:00:00Z"
          locationQuery="Port Coquitlam, BC"
          registrationOpensAt="2026-01-01T00:00:00Z"
          registrationClosesAt="2027-05-31T23:00:00Z"
          priceCents={1500}
        />,
      );
      expect(await screen.findByText('Taylor Invitee')).toBeInTheDocument();
      expect(screen.getByText(/Alex Member listed you as a partner/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Confirm participation' }));
      expect(await screen.findByText(/Your participation is confirmed/)).toBeInTheDocument();
      expect(window.location.search).toBe('');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/events/partner-confirmation',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('loads tournament management data and renders its management workspace', async () => {
    render(
      <TournamentManagement
        eventId="event-1"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={4}
        format="doubles"
        config={{ phases: { round_robin: true, final_knockout: true } }}
        priceCents={1500}
      />,
    );
    await waitFor(() => expect(supabaseMocks.fromCalls).toContain('tournament_matches'));
    expect(supabaseMocks.rpcCalls).toContain('event_tournament_member_directory');
    expect(screen.getByRole('heading', { name: 'Participants' })).toBeInTheDocument();
  });

  it('labels event-only accounts as non-members in the participant list', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'event-guest-entry',
        user_id: 'event-guest-account',
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Guest Player',
        email: 'guest@example.test',
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'member-entry',
        user_id: 'approved-member-account',
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Club Member',
        email: 'member@example.test',
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
    ];
    supabaseMocks.rpcData.event_tournament_member_directory = [
      {
        id: 'approved-member-account',
        full_name: 'Club Member',
        email: 'member@example.test',
        gender: 'male',
      },
    ];
    render(
      <TournamentManagement
        eventId="event-guest-member-labels"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    expect(await screen.findByText('Guest Player')).toBeInTheDocument();
    expect(screen.getByText('Non-member · registered')).toBeInTheDocument();
    expect(screen.getByText('Member · registered')).toBeInTheDocument();
  });

  it('handles null query results as empty collections and defaults an empty category list', async () => {
    for (const table of [
      'tournament_teams',
      'tournament_participants',
      'tournament_pairs',
      'tournament_matches',
      'tournament_audit_log',
    ])
      supabaseMocks.data[table] = null;
    supabaseMocks.rpcData.event_tournament_member_directory = null;
    render(
      <TournamentManagement
        eventId="event-null-data"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: [], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Participants' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Random group draw' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create pair' })).toBeInTheDocument();
  });

  it('surfaces tournament refresh failures and validates empty match selections', async () => {
    supabaseMocks.errors.tournament_teams = { message: 'Teams unavailable.' };
    render(
      <TournamentManagement
        eventId="event-error"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Teams unavailable.');

    supabaseMocks.errors = {};
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add match' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select two different sides.');
    expect(supabaseMocks.writes).toHaveLength(0);
  });

  it('confirms match deletion and reports a database rejection', async () => {
    supabaseMocks.data.tournament_matches = [
      {
        id: 'match-delete',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-one',
        pair_two_id: 'pair-two',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    supabaseMocks.errors['tournament_matches.delete'] = { message: 'Delete denied.' };
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-delete-match"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText('Actions for match 1'));
    await user.click(screen.getByRole('button', { name: 'Delete match' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete match?');
    const confirms = screen.getAllByRole('button', { name: 'Delete match' });
    await user.click(confirms[confirms.length - 1]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete denied.');
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({ table: 'tournament_matches', operation: 'delete' }),
    );
  });

  it('renders tournament audit entries with known, missing, and structured change details', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'audit-player-one',
        user_id: 'member-audit',
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Audit Participant',
        email: null,
        phone: null,
        gender: null,
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'audit-player-two',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Audit Partner',
        email: null,
        phone: null,
        gender: null,
        gender_override: null,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'audit-pair',
        category: 'mixed',
        player_one_id: 'audit-player-one',
        player_two_id: 'audit-player-two',
        group_number: 1,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'audit-match',
        event_id: 'event-audit',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'audit-pair',
        pair_two_id: null,
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    supabaseMocks.rpcData.event_tournament_member_directory = [
      { id: 'member-audit', full_name: 'Auditing Organizer' },
    ];
    supabaseMocks.data.tournament_audit_log = [
      {
        id: 'audit-team',
        actor_user_id: null,
        action: 'team_updated',
        entity_type: 'tournament_team',
        entity_id: 'missing-team',
        before_data: { name: 'Old name', color: null },
        after_data: {
          name: 'New name',
          score_sets: [{ one: 6, two: 3 }, 'invalid-set'],
          scheduled_at: '2027-06-01T12:00:00Z',
          ignored: { nested: true },
        },
        created_at: '2027-06-01T12:00:00Z',
      },
      {
        id: 'audit-other',
        actor_user_id: null,
        action: 'something_happened',
        entity_type: 'custom_entity',
        entity_id: 'unknown',
        before_data: null,
        after_data: null,
        created_at: '2027-06-02T12:00:00Z',
      },
      {
        id: 'audit-participant',
        actor_user_id: 'member-audit',
        action: 'participant_updated',
        entity_type: 'tournament_participant',
        entity_id: 'audit-player-one',
        before_data: { group_number: { unexpected: true }, scheduled_at: 7 },
        after_data: { display_name: 'Audit Participant', status: 'registered' },
        created_at: '2027-06-03T12:00:00Z',
      },
      {
        id: 'audit-pair-known',
        actor_user_id: 'member-audit',
        action: 'pair_updated',
        entity_type: 'tournament_pair',
        entity_id: 'audit-pair',
        before_data: null,
        after_data: null,
        created_at: '2027-06-04T12:00:00Z',
      },
      {
        id: 'audit-match-known',
        actor_user_id: 'member-audit',
        action: 'match_updated',
        entity_type: 'tournament_match',
        entity_id: 'audit-match',
        before_data: null,
        after_data: null,
        created_at: '2027-06-05T12:00:00Z',
      },
    ];
    render(
      <TournamentManagement
        eventId="event-audit"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'] }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'audit' } }),
    );
    expect(await screen.findByText('Tournament audit log (5 recent changes)')).toBeInTheDocument();
    expect(screen.getByText('Tournament record', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('Auditing Organizer', { exact: false })).toHaveLength(3);
    expect(screen.getAllByText('Club administrator', { exact: false })).toHaveLength(2);
    expect(screen.getByText('Participant updated · Audit Participant')).toBeInTheDocument();
    expect(
      screen.getByText('Pair updated · Audit Participant + Audit Partner'),
    ).toBeInTheDocument();
    expect(screen.getByText('Match updated · Mixed round robin match 1')).toBeInTheDocument();
    expect(screen.getByText('Name: Old name')).toBeInTheDocument();
    expect(screen.getByText(/Set scores: 6-3/)).toBeInTheDocument();
    expect(screen.getAllByText(/Scheduled for:/)).toHaveLength(2);
    expect(screen.getByText('Something happened · Custom entity')).toBeInTheDocument();
  });

  it.each(['doubles', 'team'] as const)(
    'hides random group draw for a one-group %s tournament',
    async (format) => {
      render(
        <TournamentManagement
          eventId={`event-one-group-${format}`}
          eventStartsAt="2027-06-01T12:00:00Z"
          eventEndsAt="2027-06-01T20:00:00Z"
          courtCount={4}
          format={format}
          config={{
            categories: [format === 'team' ? 'team' : 'mixed'],
            group_count: 1,
            phases: { round_robin: true, team_round_robin: true },
          }}
          priceCents={0}
        />,
      );

      await screen.findByRole('heading', { name: 'Participants' });
      expect(screen.queryByRole('button', { name: 'Random group draw' })).not.toBeInTheDocument();
    },
  );

  it('keeps group draw and pair group assignment in Participants, not in a separate section', async () => {
    render(
      <TournamentManagement
        eventId="event-groups"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={4}
        format="doubles"
        config={{ categories: ['mixed', 'men'], group_count: 2, phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    await waitFor(() => expect(supabaseMocks.fromCalls).toContain('tournament_pairs'));
    await screen.findByRole('heading', { name: 'Participants' });
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-category-change', { detail: { category: 'men' } }),
    );
    window.dispatchEvent(new CustomEvent('pctc-tournament-category-change', { detail: {} }));
    expect(screen.getByRole('button', { name: 'Random group draw' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Group assignments' })).not.toBeInTheDocument();
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'competition' } }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Participants' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('region', { name: 'Group assignments' })).not.toBeInTheDocument();
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'participants' } }),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Participants' })).toBeInTheDocument(),
    );
  });

  it('renders registered participants and randomizes the mixed doubles group assignment', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'player-1',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Alex Player',
        email: 'alex@example.com',
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'player-2',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Jordan Player',
        email: 'jordan@example.com',
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: null,
        status: 'registered',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-registration"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (2)');
    await user.click(screen.getByRole('button', { name: 'Random group draw' }));
    await waitFor(() =>
      expect(supabaseMocks.writes.some((write) => write.table === 'tournament_pairs')).toBe(true),
    );
    expect(supabaseMocks.writes.filter((write) => write.table === 'tournament_pairs')).toEqual([
      expect.objectContaining({ operation: 'update' }),
    ]);
  });

  it('creates a mixed doubles pair only after both eligible players are selected', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'player-1',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Alex Player',
        email: 'alex@example.com',
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'player-2',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Jordan Player',
        email: 'jordan@example.com',
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-create-pair"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (2)');
    await user.click(screen.getByPlaceholderText('Choose player'));
    await user.click(screen.getByRole('option', { name: /^Alex Player/ }));
    await user.click(screen.getByPlaceholderText('Choose partner'));
    await user.click(screen.getByRole('option', { name: /^Jordan Player/ }));
    await user.click(screen.getByRole('button', { name: 'Create pair' }));

    await waitFor(() =>
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'admin_create_tournament_pair',
        args: {
          p_event_id: 'event-create-pair',
          p_category: 'mixed',
          p_one: 'player-1',
          p_two: 'player-2',
        },
      }),
    );
  });

  it('disables a same-gender pairing in the mixed doubles player selector', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'mixed-one',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Casey One',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'mixed-two',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Casey Two',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-mixed-gender-rule"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'] }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (2)');
    await user.click(screen.getByPlaceholderText('Choose player'));
    await user.click(screen.getByRole('option', { name: /^Casey One/ }));
    await user.click(screen.getByPlaceholderText('Choose partner'));
    expect(
      await screen.findByRole('option', { name: /Mixed doubles requires different known genders/ }),
    ).toBeDisabled();
    expect(supabaseMocks.rpcCalls).not.toContain('admin_create_tournament_pair');
  });

  it('reports a pair-creation RPC error and keeps both participants available', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'pair-error-one',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Morgan One',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'pair-error-two',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Morgan Two',
        email: null,
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
    ];
    supabaseMocks.rpcErrors.admin_create_tournament_pair = { message: 'Pair conflict.' };
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-pair-error"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'] }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (2)');
    await user.click(screen.getByPlaceholderText('Choose player'));
    await user.click(screen.getByRole('option', { name: /^Morgan One/ }));
    await user.click(screen.getByPlaceholderText('Choose partner'));
    await user.click(screen.getByRole('option', { name: /^Morgan Two/ }));
    await user.click(screen.getByRole('button', { name: 'Create pair' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Pair conflict.');
    expect(supabaseMocks.rpcCalls).toContain('admin_create_tournament_pair');
    expect(supabaseMocks.writes).not.toContainEqual(
      expect.objectContaining({ table: 'tournament_pairs', operation: 'insert' }),
    );
  });

  it('reports when pairing succeeds but partner confirmation invitations fail', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'invite-error-one',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Riley One',
        email: 'riley.one@example.com',
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'invite-error-two',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Riley Two',
        email: 'riley.two@example.com',
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Email service unavailable.' }),
      }),
    );
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-invite-error"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'] }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (2)');
    await user.click(screen.getByPlaceholderText('Choose player'));
    await user.click(screen.getByRole('option', { name: /^Riley One/ }));
    await user.click(screen.getByPlaceholderText('Choose partner'));
    await user.click(screen.getByRole('option', { name: /^Riley Two/ }));
    await user.click(screen.getByRole('button', { name: 'Create pair' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pair created, but confirmation invitations could not be sent: Email service unavailable.',
    );
    expect(fetch).toHaveBeenCalledWith('/api/events/partner-invitations', expect.any(Object));
    expect(supabaseMocks.rpcCalls).toContain('admin_create_tournament_pair');
  });

  it('creates a tournament team without optional captain or logo details', async () => {
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-team-create"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="team"
        config={{ categories: ['team'] }}
        priceCents={0}
      />,
    );
    await user.type(screen.getByPlaceholderText('Team name'), 'Baseline Crew');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() =>
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'admin_create_tournament_team',
        args: {
          p_event_id: 'event-team-create',
          p_name: 'Baseline Crew',
          p_color: '',
          p_logo_url: null,
          p_captain_user_id: null,
        },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Team created.');
  });

  it('rejects a mixed pair when both selected participants have the same known gender', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'male-one',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Alex Male',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'male-two',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Jordan Male',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-same-gender-pair"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'] }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (2)');
    await user.click(screen.getByPlaceholderText('Choose player'));
    await user.click(screen.getByRole('option', { name: /^Alex Male/ }));
    await user.click(screen.getByPlaceholderText('Choose partner'));
    expect(screen.getByPlaceholderText('Choose player')).toHaveValue('Alex Male');
    expect(
      screen.getByRole('option', {
        name: /Jordan Male.*Mixed doubles requires different known genders/,
      }),
    ).toBeDisabled();
    expect(supabaseMocks.writes).not.toContainEqual(
      expect.objectContaining({ table: 'tournament_pairs', operation: 'insert' }),
    );
  });

  it('replaces a pair player and updates their future match assignments', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'player-1',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Alex Player',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'player-2',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Jordan Player',
        email: null,
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'player-3',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Sam Player',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'player-4',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Casey Player',
        email: null,
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: 1,
        status: 'registered',
      },
    ];
    supabaseMocks.rpcData.admin_require_pair_confirmation = true;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ failed: 0 }) }),
    );
    supabaseMocks.data.tournament_matches = [
      {
        id: 'future-match',
        event_id: 'event-replace-pair',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: null,
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    const user = userEvent.setup();
    const { unmount } = render(
      <TournamentManagement
        eventId="event-replace-pair"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (4)');
    await user.click(screen.getByLabelText('Actions for Alex Player and Jordan Player'));
    await user.click(screen.getAllByRole('button', { name: 'Replace Alex Player' })[0]);
    await user.click(screen.getByPlaceholderText('Choose replacement'));
    await user.click(screen.getByRole('option', { name: /^Sam Player/ }));
    await user.click(screen.getByRole('button', { name: 'Replace player' }));

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_pairs',
          operation: 'update',
          values: { player_one_id: 'player-3' },
        }),
      ),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_participants',
        operation: 'update',
        values: expect.objectContaining({ status: 'replaced', replaced_by: 'player-3' }),
      }),
    );
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'admin_require_pair_confirmation',
      args: { p_pair_id: 'pair-1' },
    });

    unmount();
    const [existingPair] = supabaseMocks.data.tournament_pairs as Array<Record<string, unknown>>;
    supabaseMocks.data.tournament_pairs = [{ ...existingPair, player_one_id: 'player-3' }];
    render(
      <TournamentManagement
        eventId="event-replace-pair"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (4)');
    await user.click(screen.getByLabelText('Actions for Sam Player and Jordan Player'));
    await user.click(screen.getAllByRole('button', { name: 'Replace Jordan Player' })[0]);
    await user.click(screen.getByPlaceholderText('Choose replacement'));
    await user.click(screen.getByRole('option', { name: /^Casey Player/ }));
    await user.click(screen.getByRole('button', { name: 'Replace player' }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_pairs',
          operation: 'update',
          values: { player_two_id: 'player-4' },
        }),
      ),
    );
  });

  it('blocks replacement while the outgoing player remains in another active pair', async () => {
    supabaseMocks.data.tournament_participants = [
      ...[
        ['shared-old', 'Alex Player', 'male'],
        ['first-partner', 'Jordan Player', 'female'],
        ['second-partner', 'Casey Player', 'female'],
        ['available-player', 'Sam Player', 'male'],
      ].map(([id, display_name, gender]) => ({
        id,
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name,
        email: null,
        phone: null,
        gender,
        gender_override: null,
        status: 'registered',
      })),
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-target',
        category: 'mixed',
        player_one_id: 'shared-old',
        player_two_id: 'first-partner',
        group_number: 1,
        status: 'registered',
      },
      {
        id: 'pair-still-assigned',
        category: 'mixed',
        player_one_id: 'shared-old',
        player_two_id: 'second-partner',
        group_number: 1,
        status: 'registered',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-old-player-still-assigned"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (4)');
    await user.click(screen.getByLabelText('Actions for Alex Player and Jordan Player'));
    await user.click(screen.getAllByRole('button', { name: 'Replace Alex Player' })[0]);
    await user.click(screen.getByPlaceholderText('Choose replacement'));
    await user.click(screen.getByRole('option', { name: /^Sam Player/ }));
    await user.click(screen.getByRole('button', { name: 'Replace player' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This player is assigned to another pair in the same category; update that draw before replacing them.',
    );
    expect(supabaseMocks.writes).toHaveLength(0);
  });

  it('reports a failed database update when replacing a pair member', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'replace-old',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Alex Replace',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'replace-partner',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Jordan Replace',
        email: null,
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'replace-new',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Sam Replacement',
        email: null,
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-update-fails',
        category: 'mixed',
        player_one_id: 'replace-old',
        player_two_id: 'replace-partner',
        group_number: 1,
        status: 'registered',
      },
    ];
    supabaseMocks.errors['tournament_pairs.update'] = { message: 'Pair row is locked.' };
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-pair-update-fails"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    await screen.findByText('Alex Replace + Jordan Replace');
    await user.click(screen.getByLabelText('Actions for Alex Replace and Jordan Replace'));
    await user.click(screen.getAllByRole('button', { name: 'Replace Alex Replace' })[0]);
    await user.click(screen.getByPlaceholderText('Choose replacement'));
    await user.click(screen.getByRole('option', { name: /^Sam Replacement/ }));
    await user.click(screen.getByRole('button', { name: 'Replace player' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Pair row is locked.');
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({ table: 'tournament_pairs', operation: 'update' }),
    );
    expect(supabaseMocks.rpcCalls).not.toContain('admin_require_pair_confirmation');
  });

  it('replaces a League pair member through the atomic League RPC', async () => {
    supabaseMocks.data.tournament_participants = [
      ...[
        ['league-old', 'Alex League', 'male'],
        ['league-partner', 'Jordan League', 'male'],
        ['league-replacement', 'Sam League', 'male'],
      ].map(([id, display_name, gender]) => ({
        id,
        user_id: id,
        team_id: null,
        category: 'men',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name,
        email: null,
        phone: null,
        gender,
        gender_override: null,
        status: 'registered',
      })),
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'league-pair',
        category: 'men',
        player_one_id: 'league-old',
        player_two_id: 'league-partner',
        group_number: 1,
        status: 'registered',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-league-replacement"
        leagueId="league-1"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['men'], phases: { round_robin: true } }}
        priceCents={0}
        leagueTournament
        leagueGender="male"
      />,
    );

    await screen.findByText('Alex League + Jordan League');
    await user.click(screen.getByLabelText('Actions for Alex League and Jordan League'));
    await user.click(screen.getAllByRole('button', { name: 'Replace Alex League' })[0]);
    await user.click(screen.getByPlaceholderText('Choose replacement'));
    await user.click(screen.getByRole('option', { name: /^Sam League/ }));
    await user.click(screen.getByRole('button', { name: 'Replace player' }));

    await waitFor(() =>
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'replace_league_team_member',
        args: {
          p_event_id: 'event-league-replacement',
          p_pair_id: 'league-pair',
          p_side: 1,
          p_replacement_participant_id: 'league-replacement',
        },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'League team updated. Future event pairs use the replacement; completed match records keep the players who played.',
    );
    expect(supabaseMocks.writes).toHaveLength(0);
  });

  it('creates a non-member participant with private contact fields', async () => {
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-new-participant"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={1500}
      />,
    );

    await user.type(screen.getByPlaceholderText('Full name'), 'Taylor Guest');
    await user.type(screen.getByPlaceholderText('Email (private)'), 'taylor@example.com');
    await user.type(screen.getByPlaceholderText('Phone (private)'), '604-555-0199');
    await user.selectOptions(screen.getByLabelText('Gender profile'), 'female');
    await user.click(screen.getByRole('button', { name: 'Add participant' }));

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual({
        table: 'tournament_participants',
        operation: 'insert',
        values: expect.objectContaining({
          display_name: 'Taylor Guest',
          email: 'taylor@example.com',
          phone: '604-555-0199',
          gender: 'female',
          category: 'mixed',
          payment_status: 'pending',
          amount_cents: 1500,
        }),
      }),
    );
  });

  it('rejects a direct admin participant submit without a name or member selection', async () => {
    render(
      <TournamentManagement
        eventId="event-missing-admin-participant"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'] }}
        priceCents={0}
      />,
    );
    await screen.findByRole('heading', { name: 'Participants' });
    fireEvent.submit(screen.getByRole('button', { name: 'Add participant' }).closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a participant name or select a member.',
    );
    expect(supabaseMocks.writes).not.toContainEqual(
      expect.objectContaining({ table: 'tournament_participants', operation: 'insert' }),
    );
  });

  it('sorts admin member choices and explains current-category, opposite-category, and gender conflicts', async () => {
    supabaseMocks.rpcData.event_tournament_member_directory = [
      {
        id: 'already-men',
        full_name: 'Alex Already In',
        email: 'alex@example.test',
        gender: 'male',
      },
      {
        id: 'already-women',
        full_name: 'Casey Other Category',
        email: 'casey@example.test',
        gender: 'male',
      },
      {
        id: 'opposing-gender',
        full_name: 'Jordan Opposing Gender',
        email: 'jordan@example.test',
        gender: 'female',
      },
      {
        id: 'available-men',
        full_name: 'Taylor Available',
        email: 'taylor@example.test',
        gender: 'male',
      },
    ];
    supabaseMocks.data.tournament_participants = [
      {
        id: 'entry-men',
        user_id: 'already-men',
        category: 'men',
        status: 'registered',
        display_name: 'Alex Already In',
      },
      {
        id: 'entry-women',
        user_id: 'already-women',
        category: 'women',
        status: 'registered',
        display_name: 'Casey Other Category',
      },
    ];

    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-member-choice-rules"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['men', 'women'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    const selector = await screen.findByPlaceholderText('Search members');
    await user.click(selector);

    expect(screen.getByRole('option', { name: /Taylor Available/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Alex Already In/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Casey Other Category/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Jordan Opposing Gender/ })).toBeDisabled();
    expect(screen.getByText(/Already added \(men doubles\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Already registered for women's doubles and cannot enter both/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Profile gender does not match men's doubles/)).toBeInTheDocument();
  });

  it('registers an eligible League member through their existing League team', async () => {
    supabaseMocks.rpcData.event_tournament_member_directory = [
      {
        id: 'league-player-1',
        full_name: 'Alex League',
        email: 'alex@example.test',
        gender: 'male',
      },
    ];
    supabaseMocks.rpcData.league_event_pair_eligibility = [
      { user_id: 'league-player-1', eligible: true },
    ];
    supabaseMocks.data.league_teams = [{ id: 'league-team-1' }];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="league-event-2"
        leagueId="league-1"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ phases: { round_robin: true } }}
        priceCents={0}
        leagueTournament
        leagueGender="male"
      />,
    );

    await user.click(await screen.findByPlaceholderText('Search active members'));
    await user.click(screen.getByRole('option', { name: /^Alex League/ }));
    await user.click(screen.getByRole('button', { name: 'Add participant' }));
    await waitFor(() =>
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'register_league_event_team',
        args: { p_event_id: 'league-event-2', p_member_id: 'league-player-1' },
      }),
    );
  });

  it.each([
    ['league_teams.maybeSingle', 'League team lookup failed.'],
    ['register_league_event_team', 'Team registration failed.'],
  ])(
    'shows an error when a League team registration fails at %s',
    async (failurePoint, message) => {
      supabaseMocks.rpcData.event_tournament_member_directory = [
        {
          id: 'league-player-1',
          full_name: 'Alex League',
          email: 'alex@example.test',
          gender: 'male',
        },
      ];
      supabaseMocks.rpcData.league_event_pair_eligibility = [
        { user_id: 'league-player-1', eligible: true },
      ];
      supabaseMocks.data.league_teams = [{ id: 'league-team-1' }];
      if (failurePoint === 'register_league_event_team') {
        supabaseMocks.rpcErrors.register_league_event_team = { message };
      } else {
        supabaseMocks.errors[failurePoint] = { message };
      }
      const user = userEvent.setup();
      render(
        <TournamentManagement
          eventId="league-event-error"
          leagueId="league-1"
          eventStartsAt="2027-06-01T12:00:00Z"
          eventEndsAt="2027-06-01T20:00:00Z"
          courtCount={2}
          format="doubles"
          config={{ phases: { round_robin: true } }}
          priceCents={0}
          leagueTournament
          leagueGender="male"
        />,
      );
      await user.click(await screen.findByPlaceholderText('Search active members'));
      await user.click(screen.getByRole('option', { name: /^Alex League/ }));
      await user.click(screen.getByRole('button', { name: 'Add participant' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
    },
  );

  it('allows an eligible new League member without a team to register for later team assignment', async () => {
    supabaseMocks.rpcData.event_tournament_member_directory = [
      {
        id: 'new-league-player',
        full_name: 'Taylor League',
        email: 'taylor@example.test',
        gender: 'female',
      },
    ];
    supabaseMocks.rpcData.league_event_pair_eligibility = [
      { user_id: 'new-league-player', eligible: true },
    ];
    supabaseMocks.data.league_teams = [];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="league-event-3"
        leagueId="league-1"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ phases: { round_robin: true } }}
        priceCents={0}
        leagueTournament
        leagueGender="female"
      />,
    );

    await user.click(await screen.findByPlaceholderText('Search active members'));
    await user.click(screen.getByRole('option', { name: /^Taylor League/ }));
    await user.click(screen.getByRole('button', { name: 'Add participant' }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_participants',
          operation: 'insert',
          values: expect.objectContaining({
            event_id: 'league-event-3',
            user_id: 'new-league-player',
            category: 'women',
            display_name: 'Taylor League',
            gender: 'female',
          }),
        }),
      ),
    );
    expect(supabaseMocks.rpcArgs).not.toContainEqual(
      expect.objectContaining({ name: 'register_league_event_team' }),
    );
  });

  it('requires an eligible League member selection and rejects members who are not eligible', async () => {
    supabaseMocks.rpcData.event_tournament_member_directory = [
      {
        id: 'unpaid-player',
        full_name: 'Taylor Unpaid',
        email: 'taylor@example.test',
        gender: 'female',
      },
    ];
    supabaseMocks.rpcData.league_event_pair_eligibility = [
      { user_id: 'unpaid-player', eligible: false },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="league-event-ineligible"
        leagueId="league-1"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ phases: { round_robin: true } }}
        priceCents={0}
        leagueTournament
        leagueGender="female"
      />,
    );
    await user.click(await screen.findByPlaceholderText('Search active members'));
    expect(
      screen.getByRole('option', { name: /Taylor Unpaid.*Active paid membership required/ }),
    ).toBeDisabled();
    expect(supabaseMocks.writes).toHaveLength(0);
  });

  it('reports missing League configuration when an eligible member is added without a League id', async () => {
    supabaseMocks.rpcData.event_tournament_member_directory = [
      {
        id: 'eligible-no-league-id',
        full_name: 'Alex League',
        email: 'alex@example.test',
        gender: 'male',
      },
    ];
    supabaseMocks.rpcData.league_event_pair_eligibility = [
      { user_id: 'eligible-no-league-id', eligible: true },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="league-event-no-league-id"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ phases: { round_robin: true } }}
        priceCents={0}
        leagueTournament
        leagueGender="male"
      />,
    );
    await user.click(await screen.findByPlaceholderText('Search active members'));
    await user.click(screen.getByRole('option', { name: /^Alex League/ }));
    await user.click(screen.getByRole('button', { name: 'Add participant' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'League configuration could not be found.',
    );
    expect(supabaseMocks.rpcCalls).not.toContain('register_league_event_team');
  });

  it('requires a selected member when the League participant form is submitted empty', async () => {
    render(
      <TournamentManagement
        eventId="league-event-empty-selection"
        leagueId="league-1"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ phases: { round_robin: true } }}
        priceCents={0}
        leagueTournament
        leagueGender="male"
      />,
    );
    const addButton = await screen.findByRole('button', { name: 'Add participant' });
    fireEvent.submit(addButton.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select an eligible active member for this League event.',
    );
    expect(supabaseMocks.writes).toHaveLength(0);
  });

  it('allows an admin to add a guest participant without optional email, phone, or gender', async () => {
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="guest-without-contact"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['men'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    await user.type(await screen.findByPlaceholderText('Full name'), 'Guest Player');
    await user.click(screen.getByRole('button', { name: 'Add participant' }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_participants',
          operation: 'insert',
          values: expect.objectContaining({
            display_name: 'Guest Player',
            email: null,
            phone: null,
            gender: null,
          }),
        }),
      ),
    );
  });

  it('syncs promoted group winners into the final knockout slots after a score edit', async () => {
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'group-pair-1',
        event_id: 'promotion-event',
        category: 'mixed',
        player_one_id: 'p1',
        player_two_id: 'p2',
        group_number: 1,
        seed: null,
        status: 'registered',
        player_one_name: 'Aces',
      },
      {
        id: 'group-pair-2',
        event_id: 'promotion-event',
        category: 'mixed',
        player_one_id: 'p3',
        player_two_id: 'p4',
        group_number: 1,
        seed: null,
        status: 'registered',
        player_one_name: 'Rockets',
      },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'completed-group-match',
        event_id: 'promotion-event',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'group-pair-1',
        pair_two_id: 'group-pair-2',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [{ one: 6, two: 4 }],
        winner_side: 1,
        team_points_one: 0,
        team_points_two: 0,
        status: 'completed',
        notes: '',
      },
      {
        id: 'final-slot-match',
        event_id: 'promotion-event',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: null,
        pair_two_id: null,
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: JSON.stringify({ slot_one: 'Group 1 Team 1', slot_two: 'TBD' }),
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="promotion-event"
        eventStartsAt="2026-06-01T12:00:00Z"
        eventEndsAt="2026-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{
          categories: ['mixed'],
          phases: { round_robin: true, final_knockout: true },
          group_count: 1,
        }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    const score = screen.getByPlaceholderText('6-4, 6-3');
    await user.clear(score);
    await user.type(score, '6-2, 6-2');
    fireEvent.blur(score);
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'update',
          values: expect.objectContaining({ pair_one_id: 'group-pair-1' }),
        }),
      ),
    );
  });

  it('validates and confirms a score replacing a walkover result', async () => {
    supabaseMocks.data.tournament_participants = [
      { id: 'player-1', category: 'mixed', status: 'registered', display_name: 'Alex' },
      { id: 'player-2', category: 'mixed', status: 'registered', display_name: 'Jordan' },
      { id: 'player-3', category: 'mixed', status: 'registered', display_name: 'Sam' },
      { id: 'player-4', category: 'mixed', status: 'registered', display_name: 'Casey' },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: 1,
        status: 'registered',
      },
      {
        id: 'pair-2',
        category: 'mixed',
        player_one_id: 'player-3',
        player_two_id: 'player-4',
        group_number: 1,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'match-1',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: 'pair-2',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: 'Walkover / retirement awarded to side one',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-score"
        eventStartsAt="2026-06-01T12:00:00Z"
        eventEndsAt="2026-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{
          categories: ['mixed'],
          phases: { round_robin: true, final_knockout: true },
          scoring_template: 'best_of_three',
        }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (4)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Final knockout' }));
    await screen.findByText('Walkover / retirement awarded to side one');
    const scoreInput = screen.getByLabelText('Set scores (e.g. 6-4, 3-6, 10-8)');
    await user.type(scoreInput, '6-4');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Best-of-three requires a player to win two sets',
    );

    await user.clear(scoreInput);
    await user.type(scoreInput, '6-4, 6-3');
    await user.tab();
    expect(await screen.findByRole('heading', { name: 'Replace walkover result?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'update',
          values: expect.objectContaining({
            score_sets: [
              { one: 6, two: 4 },
              { one: 6, two: 3 },
            ],
            winner_side: 1,
            status: 'completed',
            notes: '',
          }),
        }),
      ),
    );
  });

  it('records a knockout walkover with the selected winner and leaves completed entries untouched', async () => {
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: null,
        status: 'registered',
      },
      {
        id: 'pair-2',
        category: 'mixed',
        player_one_id: 'player-3',
        player_two_id: 'player-4',
        group_number: null,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'walkover-match',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: 'pair-2',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-walkover"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText('Actions for match 1'));
    await user.click(screen.getByRole('button', { name: 'Walkover: side two' }));

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'update',
          values: expect.objectContaining({
            winner_side: 2,
            score_sets: [],
            status: 'completed',
            notes: 'Walkover / retirement awarded to side two',
          }),
        }),
      ),
    );
  });

  it('creates a team and schedules a match between teams in the same round-robin group', async () => {
    supabaseMocks.data.tournament_teams = [
      {
        id: 'team-1',
        name: 'Team One',
        logo_url: null,
        color: 'Green',
        group_number: 1,
        captain_user_id: null,
      },
      {
        id: 'team-2',
        name: 'Team Two',
        logo_url: null,
        color: 'Blue',
        group_number: 1,
        captain_user_id: null,
      },
    ];
    supabaseMocks.data['tournament_matches.insert'] = { id: 'new-match' };
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-team-admin"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="team"
        config={{
          categories: ['team'],
          phases: { team_round_robin: true, team_knockout: true },
        }}
        priceCents={0}
      />,
    );

    await screen.findByText('Team One');
    await user.type(screen.getByPlaceholderText('Team name'), 'Team Three');
    await user.type(screen.getByPlaceholderText('Team colour (e.g. all blacks)'), 'Red');
    await user.click(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() =>
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'admin_create_tournament_team',
        args: expect.objectContaining({
          p_event_id: 'event-team-admin',
          p_name: 'Team Three',
          p_color: 'Red',
        }),
      }),
    );

    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    await user.click(screen.getByPlaceholderText('Choose side one'));
    await user.click(screen.getByRole('option', { name: /^Team One/ }));
    await user.click(screen.getByPlaceholderText('Choose side two'));
    await user.click(screen.getByRole('option', { name: /^Team Two/ }));
    await user.click(screen.getByRole('button', { name: 'Add match' }));

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'insert',
          values: expect.objectContaining({
            category: 'team',
            phase: 'team_round_robin',
            group_number: 1,
            team_one_id: 'team-1',
            team_two_id: 'team-2',
            status: 'scheduled',
          }),
        }),
      ),
    );
  });

  it('assigns a team group, reconciles unplayed matches, and preserves completed results', async () => {
    supabaseMocks.data.tournament_teams = [
      { id: 'team-a', name: 'Aces', color: 'Blue', logo_url: null, group_number: null },
      { id: 'team-b', name: 'Rockets', color: 'Red', logo_url: null, group_number: 1 },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'unplayed-team-match',
        category: 'mixed',
        phase: 'team_round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: null,
        pair_two_id: null,
        team_one_id: 'team-a',
        team_two_id: 'team-b',
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
      {
        id: 'completed-team-match',
        category: 'team',
        phase: 'team_round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 2,
        pair_one_id: null,
        pair_two_id: null,
        team_one_id: 'team-a',
        team_two_id: 'team-b',
        scheduled_at: null,
        court_number: null,
        score_sets: [{ one: 6, two: 0 }],
        winner_side: 1,
        team_points_one: 1,
        team_points_two: 0,
        status: 'completed',
        notes: '',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-team-groups"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="team"
        config={{ categories: ['team'], group_count: 2, phases: { team_round_robin: true } }}
        priceCents={0}
      />,
    );
    await screen.findAllByText('Aces');
    await user.selectOptions(screen.getByLabelText('Group for Aces'), '1');
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_teams',
          operation: 'update',
          values: { group_number: 1 },
        }),
      ),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_matches',
        operation: 'update',
        values: expect.objectContaining({ group_number: null, status: 'cancelled' }),
      }),
    );
    expect(supabaseMocks.writes).not.toContainEqual(
      expect.objectContaining({
        table: 'tournament_matches',
        operation: 'update',
        values: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('saves two distinct players as a team doubles pairing', async () => {
    supabaseMocks.data.tournament_teams = [
      { id: 'team-a', name: 'Aces', color: 'Blue', logo_url: null, group_number: 1 },
      { id: 'team-b', name: 'Rockets', color: 'Red', logo_url: null, group_number: 1 },
    ];
    supabaseMocks.data.tournament_participants = [
      {
        id: 'a1',
        user_id: null,
        team_id: 'team-a',
        category: 'team',
        display_name: 'Alex One',
        status: 'registered',
        gender: 'male',
      },
      {
        id: 'a2',
        user_id: null,
        team_id: 'team-a',
        category: 'team',
        display_name: 'Blair Two',
        status: 'registered',
        gender: 'female',
      },
      {
        id: 'b1',
        user_id: null,
        team_id: 'team-b',
        category: 'team',
        display_name: 'Casey Three',
        status: 'registered',
        gender: 'male',
      },
      {
        id: 'b2',
        user_id: null,
        team_id: 'team-b',
        category: 'team',
        display_name: 'Drew Four',
        status: 'registered',
        gender: 'female',
      },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'team-match',
        category: 'mixed',
        phase: 'team_round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: null,
        pair_two_id: null,
        team_one_id: 'team-a',
        team_two_id: 'team-b',
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-team-pairing"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="team"
        config={{ categories: ['mixed'], phases: { team_round_robin: true } }}
        priceCents={0}
      />,
    );
    await screen.findAllByText('Aces');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    const playerOne = screen.getAllByPlaceholderText('Choose player one')[0];
    await user.click(playerOne);
    await user.click(screen.getByRole('option', { name: /^Alex One/ }));
    const playerTwo = screen.getAllByPlaceholderText('Choose player two')[0];
    await user.click(playerTwo);
    await user.click(screen.getByRole('option', { name: /^Blair Two/ }));
    await user.click(screen.getAllByRole('button', { name: 'Save lineup' })[0]);
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_match_players',
          operation: 'insert',
          values: expect.arrayContaining([
            expect.objectContaining({
              match_id: 'team-match',
              participant_id: 'a1',
              side: 1,
              team_id: 'team-a',
            }),
            expect.objectContaining({
              match_id: 'team-match',
              participant_id: 'a2',
              side: 1,
              team_id: 'team-a',
            }),
          ]),
        }),
      ),
    );
  });

  it('generates and schedules missing round-robin matches for grouped pairs', async () => {
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: 1,
        status: 'registered',
      },
      {
        id: 'pair-2',
        category: 'mixed',
        player_one_id: 'player-3',
        player_two_id: 'player-4',
        group_number: 1,
        status: 'registered',
      },
    ];
    supabaseMocks.data['tournament_matches.insert'] = [
      {
        id: 'generated-match',
        event_id: 'event-schedule',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: 'pair-2',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-schedule"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Suggest schedule' }));

    expect(await screen.findByRole('status')).toHaveTextContent('1 matches scheduled');
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_matches',
        operation: 'insert',
        values: expect.arrayContaining([
          expect.objectContaining({
            pair_one_id: 'pair-1',
            pair_two_id: 'pair-2',
            group_number: 1,
          }),
        ]),
      }),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_matches',
        operation: 'update',
        values: expect.objectContaining({ scheduled_at: expect.any(String), court_number: 1 }),
      }),
    );
  });

  it('resolves a same-court schedule conflict by moving the conflicting match', async () => {
    supabaseMocks.data.tournament_matches = [
      {
        id: 'match-one',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-one',
        pair_two_id: 'pair-two',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: new Date(2027, 5, 1, 9).toISOString(),
        court_number: 1,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
      {
        id: 'match-two',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 2,
        pair_one_id: 'pair-three',
        pair_two_id: 'pair-four',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: new Date(2027, 5, 1, 9).toISOString(),
        court_number: 1,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-conflicts"
        eventStartsAt={new Date(2027, 5, 1, 8).toISOString()}
        eventEndsAt={new Date(2027, 5, 1, 20).toISOString()}
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    const matchTwoActions = await screen.findByLabelText('Actions for match 2');
    const matchTwoCard = matchTwoActions.closest('[draggable="true"]');
    expect(matchTwoCard).not.toBeNull();
    const matchTwoDateTime = matchTwoCard?.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement | null;
    expect(matchTwoDateTime).not.toBeNull();
    const originalStart = new Date(2027, 5, 1, 9);
    const movedStart = new Date(originalStart.getTime() + 15 * 60 * 1000)
      .toLocaleString('sv-SE')
      .replace(' ', 'T')
      .slice(0, 16);
    fireEvent.change(matchTwoDateTime as HTMLInputElement, { target: { value: movedStart } });
    expect(supabaseMocks.writes).toEqual([]);
    const conflictDialog = await screen.findByRole('alertdialog');
    expect(conflictDialog).toHaveTextContent('Schedule conflict detected');
    await user.click(
      within(conflictDialog).getByRole('button', { name: 'Move conflicting matches' }),
    );

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'update',
          values: expect.objectContaining({ court_number: 1 }),
        }),
      ),
    );
    expect(
      supabaseMocks.writes.filter(
        (write) =>
          write.table === 'tournament_matches' &&
          write.operation === 'update' &&
          typeof (write.values as Record<string, unknown>).scheduled_at === 'string',
      ),
    ).toHaveLength(2);
    expect(
      supabaseMocks.writes.filter(
        (write) => write.table === 'tournament_matches' && write.operation === 'update',
      ),
    ).toHaveLength(2);
  });

  it('creates and schedules a knockout bracket for eligible pairs without round robin', async () => {
    supabaseMocks.data.tournament_participants = [
      { id: 'player-1', category: 'mixed', status: 'registered', display_name: 'Alex' },
      { id: 'player-2', category: 'mixed', status: 'registered', display_name: 'Jordan' },
      { id: 'player-3', category: 'mixed', status: 'registered', display_name: 'Sam' },
      { id: 'player-4', category: 'mixed', status: 'registered', display_name: 'Casey' },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: null,
        status: 'registered',
        player_one_name: 'Alex + Jordan',
        player_two_name: 'Sam + Casey',
      },
      {
        id: 'pair-2',
        category: 'mixed',
        player_one_id: 'player-3',
        player_two_id: 'player-4',
        group_number: null,
        status: 'registered',
        player_one_name: 'Sam + Casey',
        player_two_name: 'Alex + Jordan',
      },
    ];
    supabaseMocks.data['tournament_matches.insert'] = [
      {
        id: 'knockout-1',
        event_id: 'event-knockout',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: 'pair-2',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-knockout"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: false, final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Sam + Casey');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await waitFor(() =>
      expect(screen.getByText('Matches, scheduling and results')).toBeInTheDocument(),
    );
    await user.click(await screen.findByRole('button', { name: 'Create draw' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Created a 1-round knockout bracket and suggested a schedule.',
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_matches',
        operation: 'insert',
        values: expect.arrayContaining([
          expect.objectContaining({
            phase: 'final_knockout',
            round_number: 1,
            status: 'scheduled',
          }),
        ]),
      }),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_match_players',
        operation: 'insert',
        values: expect.arrayContaining([
          expect.objectContaining({ match_id: 'knockout-1', participant_id: 'player-1' }),
        ]),
      }),
    );
  });

  it('rejects a knockout draw with only one eligible pair', async () => {
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'only-pair',
        category: 'mixed',
        player_one_id: 'one',
        player_two_id: 'two',
        group_number: null,
        status: 'registered',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-one-pair"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{
          categories: ['mixed'],
          phases: { round_robin: false, final_knockout: true },
        }}
        priceCents={0}
      />,
    );

    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    await user.click(screen.getByRole('button', { name: 'Create draw' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'At least two eligible teams or pairs are required for a knockout draw.',
    );
    expect(supabaseMocks.writes).not.toContainEqual(
      expect.objectContaining({ table: 'tournament_matches', operation: 'insert' }),
    );
  });

  it('adds a knockout BYE with one real side and auto-advances that side', async () => {
    supabaseMocks.data.tournament_participants = [
      { id: 'p1', category: 'mixed', status: 'registered', display_name: 'Alex' },
      { id: 'p2', category: 'mixed', status: 'registered', display_name: 'Jordan' },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'p1',
        player_two_id: 'p2',
        group_number: null,
        status: 'registered',
        player_one_name: 'Alex + Jordan',
      },
    ];
    supabaseMocks.data['tournament_matches.insert'] = {
      id: 'bye-match',
      event_id: 'event-bye',
      category: 'mixed',
      phase: 'final_knockout',
      round_number: 1,
      match_number: 1,
      pair_one_id: 'pair-1',
      pair_two_id: null,
      team_one_id: null,
      team_two_id: null,
      scheduled_at: null,
      court_number: null,
      score_sets: [],
      winner_side: 1,
      team_points_one: 0,
      team_points_two: 0,
      status: 'bye',
      notes: '',
    };
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-bye"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (2)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    await user.click(screen.getByPlaceholderText('Choose side one'));
    await user.click(screen.getAllByRole('option', { name: /Alex \+ Jordan/ })[0]);
    await user.click(screen.getByPlaceholderText('Choose side two'));
    await user.click(screen.getByRole('option', { name: /BYE — automatic advancement/ }));
    await user.click(screen.getByRole('button', { name: 'Add match' }));

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'insert',
          values: expect.objectContaining({
            pair_one_id: 'pair-1',
            pair_two_id: null,
            status: 'bye',
            winner_side: 1,
          }),
        }),
      ),
    );
  });

  it('supports a BYE on side one with the advancing participant on side two', async () => {
    supabaseMocks.data.tournament_participants = [
      { id: 'bye-player-one', category: 'mixed', status: 'registered', display_name: 'Alex' },
      { id: 'bye-player-two', category: 'mixed', status: 'registered', display_name: 'Jordan' },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'bye-pair',
        category: 'mixed',
        player_one_id: 'bye-player-one',
        player_two_id: 'bye-player-two',
        group_number: null,
        status: 'registered',
        player_one_name: 'Alex + Jordan',
      },
    ];
    supabaseMocks.data['tournament_matches.insert'] = {
      id: 'bye-second-side',
      event_id: 'event-bye-second-side',
      category: 'mixed',
      phase: 'final_knockout',
      group_number: null,
      round_number: 1,
      match_number: 1,
      pair_one_id: null,
      pair_two_id: 'bye-pair',
      team_one_id: null,
      team_two_id: null,
      scheduled_at: null,
      court_number: null,
      score_sets: [],
      winner_side: 2,
      team_points_one: 0,
      team_points_two: 0,
      status: 'bye',
      notes: '',
    };
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-bye-second-side"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (2)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    await user.click(screen.getByPlaceholderText('Choose side two'));
    await user.click(screen.getAllByRole('option', { name: /Alex \+ Jordan/ })[0]);
    await user.click(screen.getByPlaceholderText('Choose side one'));
    await user.click(screen.getByRole('option', { name: /BYE — automatic advancement/ }));
    await user.click(screen.getByRole('button', { name: 'Add match' }));

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'insert',
          values: expect.objectContaining({
            pair_one_id: null,
            pair_two_id: 'bye-pair',
            winner_side: 2,
            status: 'bye',
          }),
        }),
      ),
    );
  });

  it('adds a knockout match using two promoted group slots', async () => {
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'slot-pair-one',
        category: 'mixed',
        player_one_id: 'p1',
        player_two_id: 'p2',
        group_number: 1,
        status: 'registered',
        player_one_name: 'Alex + Jordan',
      },
      {
        id: 'slot-pair-two',
        category: 'mixed',
        player_one_id: 'p3',
        player_two_id: 'p4',
        group_number: 2,
        status: 'registered',
        player_one_name: 'Casey + Drew',
      },
    ];
    supabaseMocks.data['tournament_matches.insert'] = {
      id: 'slot-knockout-match',
      event_id: 'event-slot-match',
      category: 'mixed',
      phase: 'final_knockout',
      group_number: null,
      round_number: 1,
      match_number: 1,
      pair_one_id: null,
      pair_two_id: null,
      team_one_id: null,
      team_two_id: null,
      scheduled_at: null,
      court_number: null,
      score_sets: [],
      winner_side: null,
      team_points_one: 0,
      team_points_two: 0,
      status: 'scheduled',
      notes: '',
    };
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-slot-match"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{
          categories: ['mixed'],
          group_count: 2,
          promoted_teams_per_group: 1,
          phases: { round_robin: true, final_knockout: true },
        }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    await user.click(screen.getByRole('button', { name: 'Final knockout' }));
    await user.click(screen.getByPlaceholderText('Choose side one'));
    await user.click(screen.getByRole('option', { name: /^Group 1 Team 1/ }));
    await user.click(screen.getByPlaceholderText('Choose side two'));
    await user.click(screen.getByRole('option', { name: /^Group 2 Team 1/ }));
    await user.click(screen.getByRole('button', { name: 'Add match' }));

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'insert',
          values: expect.objectContaining({
            phase: 'final_knockout',
            pair_one_id: null,
            pair_two_id: null,
            status: 'scheduled',
            notes: JSON.stringify({ slot_one: 'Group 1 Team 1', slot_two: 'Group 2 Team 1' }),
          }),
        }),
      ),
    );
  });

  it('rejects match times outside the event window or court operating hours', async () => {
    supabaseMocks.data.tournament_participants = [
      { id: 'p1', category: 'mixed', status: 'registered', display_name: 'Alex' },
      { id: 'p2', category: 'mixed', status: 'registered', display_name: 'Jordan' },
      { id: 'p3', category: 'mixed', status: 'registered', display_name: 'Sam' },
      { id: 'p4', category: 'mixed', status: 'registered', display_name: 'Casey' },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'p1',
        player_two_id: 'p2',
        group_number: null,
        status: 'registered',
        player_one_name: 'Alex + Jordan',
      },
      {
        id: 'pair-2',
        category: 'mixed',
        player_one_id: 'p3',
        player_two_id: 'p4',
        group_number: null,
        status: 'registered',
        player_one_name: 'Sam + Casey',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-invalid-schedule"
        eventStartsAt="2027-06-01T00:00:00Z"
        eventEndsAt="2027-06-03T00:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (4)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    await user.click(screen.getByPlaceholderText('Choose side one'));
    await user.click(screen.getByRole('option', { name: /Alex \+ Jordan/ }));
    await user.click(screen.getByPlaceholderText('Choose side two'));
    await user.click(screen.getByRole('option', { name: /Sam \+ Casey/ }));
    fireEvent.change(screen.getByLabelText('Date and time (optional)'), {
      target: { value: '2027-06-01T22:00' },
    });
    await user.click(screen.getByRole('button', { name: 'Add match' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Matches may start no earlier than 8:00 AM',
    );
    expect(supabaseMocks.writes).not.toContainEqual(
      expect.objectContaining({ table: 'tournament_matches', operation: 'insert' }),
    );

    fireEvent.change(screen.getByLabelText('Date and time (optional)'), {
      target: { value: '2027-06-04T10:00' },
    });
    await user.click(screen.getByRole('button', { name: 'Add match' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Match time must fall within the tournament dates.',
    );
  });

  it('disables knockout draw regeneration once a result exists', async () => {
    supabaseMocks.data.tournament_pairs = [
      { id: 'pair-a', category: 'mixed', group_number: null, status: 'registered' },
      { id: 'pair-b', category: 'mixed', group_number: null, status: 'registered' },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'completed-knockout',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-a',
        pair_two_id: 'pair-b',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [{ one: 6, two: 3 }],
        winner_side: 1,
        team_points_one: 0,
        team_points_two: 0,
        status: 'completed',
        notes: '',
      },
    ];
    render(
      <TournamentManagement
        eventId="event-protected-draw"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: false, final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    expect(screen.getByRole('button', { name: 'Create draw' })).toBeDisabled();
    expect(supabaseMocks.writes).toHaveLength(0);
  });

  it('confirms a conflicting court assignment and saves the selected court', async () => {
    supabaseMocks.data.tournament_matches = [1, 2].map((number) => ({
      id: `court-match-${number}`,
      category: 'mixed',
      phase: 'final_knockout',
      group_number: null,
      round_number: 1,
      match_number: number,
      pair_one_id: `pair-${number}-one`,
      pair_two_id: `pair-${number}-two`,
      team_one_id: null,
      team_two_id: null,
      scheduled_at: new Date(2027, 5, 1, 9).toISOString(),
      court_number: number,
      score_sets: [],
      winner_side: null,
      team_points_one: 0,
      team_points_two: 0,
      status: 'scheduled',
      notes: '',
    }));
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-court-move"
        eventStartsAt={new Date(2027, 5, 1, 8).toISOString()}
        eventEndsAt={new Date(2027, 5, 1, 20).toISOString()}
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { final_knockout: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (0)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    const firstCard = screen.getByLabelText('Actions for match 1').closest('[draggable="true"]');
    const courtSelect = within(firstCard as HTMLElement).getByLabelText('Court');
    await user.selectOptions(courtSelect, '2');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('court assignment anyway');
    expect(supabaseMocks.writes).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Save assignment anyway' }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'update',
          values: expect.objectContaining({ court_number: 2 }),
        }),
      ),
    );
  });

  it('replaces a scheduled round-robin match side and refreshes its player assignments', async () => {
    supabaseMocks.data.tournament_participants = [
      ...['Alex', 'Blair', 'Casey', 'Drew', 'Elliot', 'Finley'].map((name, index) => ({
        id: `player-${index + 1}`,
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: name,
        email: null,
        phone: null,
        gender: index % 2 ? 'female' : 'male',
        gender_override: null,
        status: 'registered',
      })),
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-one',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: 1,
        status: 'registered',
      },
      {
        id: 'pair-two',
        category: 'mixed',
        player_one_id: 'player-3',
        player_two_id: 'player-4',
        group_number: 1,
        status: 'registered',
      },
      {
        id: 'pair-three',
        category: 'mixed',
        player_one_id: 'player-5',
        player_two_id: 'player-6',
        group_number: 1,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'replace-side-match',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-one',
        pair_two_id: 'pair-two',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '{}',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-replace-match-side"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );
    await screen.findByText('Registered participants (6)');
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findByText('Matches, scheduling and results');
    const select = screen.getByPlaceholderText('Choose side one or a group slot');
    await user.click(select);
    await user.click(screen.getByRole('option', { name: /Elliot \+ Finley/ }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'update',
          values: expect.objectContaining({ pair_one_id: 'pair-three' }),
        }),
      ),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({ table: 'tournament_match_players', operation: 'delete' }),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({ table: 'tournament_match_players', operation: 'insert' }),
    );
  });

  it('withdraws a participant, cancels their unplayed pair match, and removes player assignments', async () => {
    supabaseMocks.data.tournament_participants = [
      {
        id: 'player-1',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Alex Player',
        email: 'alex@example.com',
        phone: null,
        gender: 'male',
        gender_override: null,
        status: 'registered',
      },
      {
        id: 'player-2',
        user_id: null,
        team_id: null,
        category: 'mixed',
        payment_status: 'not_required',
        amount_cents: 0,
        display_name: 'Jordan Player',
        email: 'jordan@example.com',
        phone: null,
        gender: 'female',
        gender_override: null,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_pairs = [
      {
        id: 'pair-1',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: 1,
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_matches = [
      {
        id: 'match-1',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: null,
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        notes: '',
      },
    ];
    supabaseMocks.data.tournament_match_players = [
      { match_id: 'match-1', participant_id: 'player-1', side: 1, team_id: null },
    ];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="event-withdraw"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        priceCents={0}
      />,
    );

    await screen.findByText('Alex Player');
    await user.click(screen.getByLabelText('More actions for Alex Player'));
    await user.click(screen.getAllByRole('button', { name: 'Remove player' })[0]);
    const confirmButtons = screen.getAllByRole('button', { name: 'Remove player' });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_participants',
          operation: 'update',
          values: expect.objectContaining({ status: 'withdrawn' }),
        }),
      ),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_pairs',
        operation: 'update',
        values: expect.objectContaining({ status: 'withdrawn' }),
      }),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_matches',
        operation: 'update',
        values: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({ table: 'tournament_match_players', operation: 'delete' }),
    );
  });

  it.each([
    ['tournament_participants.update', 'Participant update denied.'],
    ['tournament_pairs.update', 'Pair update denied.'],
  ])(
    'reports a database error when participant withdrawal fails at %s',
    async (operation, error) => {
      supabaseMocks.data.tournament_participants = [
        {
          id: 'player-1',
          user_id: null,
          team_id: null,
          category: 'mixed',
          payment_status: 'not_required',
          amount_cents: 0,
          display_name: 'Alex Player',
          email: 'alex@example.com',
          phone: null,
          gender: 'male',
          gender_override: null,
          status: 'registered',
        },
      ];
      supabaseMocks.data.tournament_pairs =
        operation === 'tournament_pairs.update'
          ? [
              {
                id: 'pair-1',
                category: 'mixed',
                player_one_id: 'player-1',
                player_two_id: 'player-2',
                group_number: 1,
                status: 'registered',
              },
            ]
          : [];
      supabaseMocks.errors[operation] = { message: error };
      const user = userEvent.setup();
      render(
        <TournamentManagement
          eventId="event-withdraw-error"
          eventStartsAt="2027-06-01T12:00:00Z"
          eventEndsAt="2027-06-01T20:00:00Z"
          courtCount={2}
          format="doubles"
          config={{ categories: ['mixed'], phases: { round_robin: true } }}
          priceCents={0}
        />,
      );

      await screen.findByText('Alex Player');
      await user.click(screen.getByLabelText('More actions for Alex Player'));
      await user.click(screen.getAllByRole('button', { name: 'Remove player' })[0]);
      const confirms = screen.getAllByRole('button', { name: 'Remove player' });
      await user.click(confirms[confirms.length - 1]);
      expect(await screen.findByRole('alert')).toHaveTextContent(error);
    },
  );

  it('explains that registration remains closed before its opening date', async () => {
    render(
      <TournamentPublicView
        eventId="event-not-open"
        currentUserId={null}
        format="singles"
        config={{ categories: ['mixed'], registration_mode: 'individual' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2027-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
      />,
    );

    expect(await screen.findByText('Registration is not currently open.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
  });

  it('renders the public tournament tabs and loads only public competition views for anonymous visitors', async () => {
    render(
      <TournamentPublicView
        eventId="event-1"
        currentUserId="guest-session-user"
        currentUserAccountKind="event_guest"
        currentUserEmail="taylor@example.test"
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        rulesHtml="<p>Rules</p>"
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2027-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
      />,
    );
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(screen.getByRole('region', { name: 'Tournament rules' })).toHaveTextContent('Rules');
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('tab', { name: /Groups, Schedule & Results/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tournament' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Registration' })).toBeInTheDocument();
    expect(screen.getByTestId('event-weather')).toBeInTheDocument();
    await waitFor(() =>
      expect(supabaseMocks.fromCalls).toContain('tournament_public_participants'),
    );
    expect(supabaseMocks.fromCalls).not.toContain('tournament_participants');
  });

  it('explains when a member gender does not match any enabled doubles category', async () => {
    supabaseMocks.data.profiles = { gender: 'female' };
    render(
      <TournamentPublicView
        eventId="men-only-doubles"
        currentUserId="member-1"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={0}
      />,
    );

    expect(
      await screen.findByText(
        'Your recorded gender does not match any enabled doubles category. Contact the organizer if it needs to be corrected for this tournament.',
      ),
    ).toBeInTheDocument();
  });

  it('ignores deep links to hidden rules and League match tabs', async () => {
    window.history.replaceState({}, '', '/events/open?tab=rules');
    const baseProps = {
      eventId: 'tab-fallback',
      currentUserId: null,
      format: 'singles' as const,
      config: { categories: ['mixed'] },
      rulesHtml: null,
      detailsPublic: true,
      allowNonMemberRegistration: false,
      eventStatus: 'published',
      startsAt: '2027-06-01T12:00:00Z',
      endsAt: null,
      locationQuery: '',
      registrationOpensAt: '2027-01-01T00:00:00Z',
      registrationClosesAt: null,
      priceCents: 0,
    };
    const { unmount } = render(<TournamentPublicView {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.queryByRole('tab', { name: 'Rules' })).not.toBeInTheDocument();

    unmount();
    window.history.replaceState({}, '', '/events/league?tab=matches');
    render(
      <TournamentPublicView
        {...baseProps}
        eventId="league-tab-fallback"
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.queryByRole('tab', { name: 'Matches' })).not.toBeInTheDocument();
  });

  it('renders results-only public view with empty server data and missing configuration defaults', async () => {
    for (const table of [
      'tournament_public_teams',
      'tournament_public_group_overrides',
      'tournament_public_participants',
      'tournament_public_pairs',
      'tournament_public_matches',
      'tournament_public_match_players',
    ])
      supabaseMocks.data[table] = null;
    render(
      <TournamentPublicView
        eventId="results-only-empty"
        currentUserId={null}
        format="doubles"
        config={{ categories: [] }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
        resultsOnly
        rankingsControl={<div>Rankings competition selector</div>}
      />,
    );

    expect(await screen.findByText('Rankings competition selector')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Registration' })).not.toBeInTheDocument();
    await waitFor(() => expect(supabaseMocks.fromCalls).toContain('tournament_public_matches'));
  });

  it('does not offer League score entry to an administrator before the scheduled start', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2027-06-01T10:00:00Z').getTime());
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'future-league-match',
        event_id: 'future-league-event',
        category: 'men',
        phase: 'round_robin',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'league-pair-one',
        pair_two_id: 'league-pair-two',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: '2027-06-01T12:00:00Z',
        court_number: 1,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        player_one_name: 'Alex / Jordan',
        player_two_name: 'Casey / Drew',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'league-pair-one',
        event_id: 'future-league-event',
        category: 'men',
        player_one_id: 'p1',
        player_two_id: 'p2',
        status: 'registered',
        player_one_name: 'Alex',
        player_two_name: 'Jordan',
      },
      {
        id: 'league-pair-two',
        event_id: 'future-league-event',
        category: 'men',
        player_one_id: 'p3',
        player_two_id: 'p4',
        status: 'registered',
        player_one_name: 'Casey',
        player_two_name: 'Drew',
      },
    ];
    render(
      <TournamentPublicView
        eventId="future-league-event"
        currentUserId="admin-1"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
        adminContent={<div>Admin controls</div>}
      />,
    );

    expect(await screen.findByText('Score entry opens when the event starts.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save score' })).not.toBeInTheDocument();
  });

  it('keeps the League court view usable when optional competition queries return null', async () => {
    supabaseMocks.data.tournament_public_teams = null;
    supabaseMocks.data.tournament_public_participants = null;
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'league-pair-null-fallback',
        event_id: 'league-null-fallback',
        category: 'men',
        player_one_id: 'member-one',
        player_two_id: 'member-two',
        group_number: 1,
        status: 'registered',
        player_one_name: null,
        player_two_name: null,
      },
    ];
    supabaseMocks.data.tournament_public_matches = null;
    supabaseMocks.data.tournament_group_overrides = null;
    supabaseMocks.data.league_event_court_assignments = null;
    supabaseMocks.data.tournament_match_players = null;
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="league-null-fallback"
        currentUserId={null}
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
      />,
    );

    expect(await screen.findByRole('region', { name: 'Players and courts' })).toBeInTheDocument();
    expect(screen.getByText('No scores have been entered.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Court view' }));
    expect(screen.getByRole('button', { name: 'Court view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('No court assignments yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Schedule & Results' }));
    expect(
      await screen.findByText('No matches have been scheduled for this category yet.'),
    ).toBeInTheDocument();
  });

  it('rejects a League score with equal team scores before calling the score RPC', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2027-06-01T13:00:00Z').getTime());
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'started-league-match',
        event_id: 'started-league-event',
        category: 'men',
        phase: 'round_robin',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'league-pair-one',
        pair_two_id: 'league-pair-two',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: '2027-06-01T12:00:00Z',
        court_number: 1,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        player_one_name: 'Alex / Jordan',
        player_two_name: 'Casey / Drew',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'league-pair-one',
        event_id: 'started-league-event',
        category: 'men',
        player_one_id: 'p1',
        player_two_id: 'p2',
        status: 'registered',
        player_one_name: 'Alex',
        player_two_name: 'Jordan',
      },
      {
        id: 'league-pair-two',
        event_id: 'started-league-event',
        category: 'men',
        player_one_id: 'p3',
        player_two_id: 'p4',
        status: 'registered',
        player_one_name: 'Casey',
        player_two_name: 'Drew',
      },
    ];
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="started-league-event"
        currentUserId="admin-1"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
        adminContent={<div>Admin controls</div>}
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText('Court / sub-session'),
      'started-league-match',
    );
    await user.type(screen.getByLabelText('Team score'), '6');
    await user.type(screen.getByLabelText('Opposing team score'), '6');
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    expect(alert).toHaveBeenCalledWith('Enter two different non-negative scores.');
    expect(supabaseMocks.rpcCalls).not.toContain('submit_league_match_score');

    fireEvent.change(screen.getByLabelText('Team score'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Opposing team score'), { target: { value: '4' } });
    supabaseMocks.rpcErrors.submit_league_match_score = { message: 'Score update denied.' };
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Score update denied.'));

    delete supabaseMocks.rpcErrors.submit_league_match_score;
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    await waitFor(() =>
      expect(screen.queryByText('No scores have been entered.')).not.toBeInTheDocument(),
    );
    expect(supabaseMocks.rpcCalls).toContain('submit_league_match_score');
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('reports rejected public registrations and clears errors when a retry starts', async () => {
    supabaseMocks.rpcErrors.register_event_guest_tournament_entry = {
      message: 'Registration is closed.',
    };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="event-registration-error"
        currentUserId="guest-session-user"
        currentUserAccountKind="event_guest"
        currentUserEmail="taylor@example.test"
        format="singles"
        config={{ categories: ['mixed'], registration_mode: 'individual' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={0}
      />,
    );
    await screen.findByRole('heading', { name: 'Tournament registration' });
    await user.type(screen.getByLabelText('Your full name'), 'Taylor Guest');
    await user.click(await screen.findByRole('button', { name: 'Register for tournament' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration is closed.');
    expect(supabaseMocks.rpcArgs).toContainEqual(
      expect.objectContaining({ name: 'register_event_guest_tournament_entry' }),
    );
  });

  it('offers a one-time sign-in link to public guests and handles existing member accounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sent: true, message: 'Check your email for a sign-in link.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventTitle="Summer Open"
        eventSlug="summer-open"
        eventId="event-guest-access"
        currentUserId={null}
        format="doubles"
        config={{ categories: ['mixed'], registration_mode: 'single' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={0}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Register' }));
    expect(screen.getByText(/one-time sign-in link/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'guest@example.test');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events/guest-access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'guest@example.test', eventId: 'event-guest-access' }),
      }),
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ memberLoginRequired: true, message: 'Please log in as a member.' }),
    });
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByText(/Please log in as a member\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fevents%2Fsummer-open',
    );

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ sent: true }) });
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Check your email for a sign-in link.',
    );

    fetchMock.mockRejectedValueOnce('network unavailable');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the sign-in link.');
  });

  it('shows the member sign-in path when public event registration is disabled and reports link failures', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TournamentPublicView
        eventId="event-members-only"
        currentUserId={null}
        format="singles"
        config={{ categories: ['men'], registration_mode: 'individual' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
      />,
    );
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fevents%2Fevent-members-only',
    );
    rerender(
      <TournamentPublicView
        eventId="event-public"
        currentUserId={null}
        format="singles"
        config={{ categories: ['men'], registration_mode: 'individual' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
      />,
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Email limit reached.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await user.click(await screen.findByRole('button', { name: 'Register' }));
    await user.type(screen.getByLabelText('Email'), 'guest@example.test');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email limit reached.');
  });

  it('registers the confirmed League team together from either team member’s event page', async () => {
    supabaseMocks.data.league_teams = { id: 'league-team-1' };
    supabaseMocks.rpcData.register_league_event_team = {
      participantId: 'league-entry-one',
      partnerParticipantId: 'league-entry-two',
      amountCents: 3000,
    };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventTitle="League event 2"
        eventId="league-event-2"
        currentUserId="league-member-one"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml="<p>League rules</p>"
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Register my team' }));
    expect(
      await screen.findByText(/Your team is registered\. Payment is pending/),
    ).toBeInTheDocument();
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'register_league_event_team',
      args: { p_event_id: 'league-event-2', p_member_id: 'league-member-one' },
    });
    expect(screen.queryByRole('button', { name: /^Register$/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
  });

  it('uses the configured fee when the League team registration RPC omits payment details', async () => {
    supabaseMocks.data.league_teams = { id: 'league-team-fallback' };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="league-team-fallback-event"
        currentUserId="league-member-fallback"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={1800}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Register my team' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your team is registered. Payment is pending; you can pay for both players together.',
    );
    expect(supabaseMocks.rpcArgs).toContainEqual(
      expect.objectContaining({
        name: 'register_league_event_team',
        args: { p_event_id: 'league-team-fallback-event', p_member_id: 'league-member-fallback' },
      }),
    );
  });

  it('reports League team registration RPC errors to the player', async () => {
    supabaseMocks.data.league_teams = { id: 'league-team-error' };
    supabaseMocks.rpcErrors.register_league_event_team = { message: 'League event is full.' };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="league-team-error-event"
        currentUserId="league-member-error"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={1800}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Register my team' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('League event is full.');
  });

  it('lets a new League participant register as a single and derives category from League gender', async () => {
    supabaseMocks.rpcData.register_league_single_event_entry = {
      participantId: 'league-single-entry',
      amountCents: 1200,
    };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="league-new-player-event"
        currentUserId="new-league-member"
        currentUserGender="female"
        format="doubles"
        config={{ categories: ['women'], registration_mode: 'both' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={1200}
        leagueTournament
        leagueId="league-1"
        leagueGender="female"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Register for League event' }));
    expect(await screen.findByText(/Registration saved\. Payment is pending/)).toBeInTheDocument();
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'register_league_single_event_entry',
      args: { p_event_id: 'league-new-player-event' },
    });
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
  });

  it('falls back to the event fee for a League single when the RPC omits its amount and entry ID', async () => {
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="league-single-fallback-event"
        currentUserId="new-league-single"
        currentUserGender="female"
        format="doubles"
        config={{ categories: ['women'], registration_mode: 'both' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={900}
        leagueTournament
        leagueId="league-1"
        leagueGender="female"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Register for League event' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Registration saved. Payment is pending',
    );
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'register_league_single_event_entry',
      args: { p_event_id: 'league-single-fallback-event' },
    });
  });

  it('lets a League member register with a member partner before their team is fixed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sent: true }) }),
    );
    supabaseMocks.rpcData.event_tournament_partner_directory = [
      { id: 'league-partner-member', full_name: 'Jordan Partner', gender: 'male' },
    ];
    supabaseMocks.rpcData.register_tournament_entry = {
      participantId: 'league-member-entry',
      partnerParticipantId: 'league-partner-entry',
      partnerEmail: 'jordan@example.test',
      amountCents: 1200,
    };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="league-pair-event"
        currentUserId="league-member-one"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'both' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={1200}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
      />,
    );

    await user.selectOptions(await screen.findByLabelText('Registration type'), 'pair');
    const partnerSelect = screen.getByRole('combobox', { name: 'Partner' });
    await user.type(partnerSelect, 'Jordan Partner');
    await user.click(await screen.findByRole('option', { name: /Jordan Partner/ }));
    await user.click(screen.getByRole('button', { name: 'Register for League event' }));

    expect(supabaseMocks.rpcArgs).toContainEqual(
      expect.objectContaining({
        name: 'register_tournament_entry',
        args: expect.objectContaining({
          p_event_id: 'league-pair-event',
          p_category: 'men',
          p_partner_user_id: 'league-partner-member',
        }),
      }),
    );
  });

  it('confirms and withdraws both players in an already registered League team', async () => {
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'league-own-entry',
        event_id: 'league-withdraw-event',
        category: 'men',
        status: 'registered',
        display_name: 'Alex Member',
      },
      {
        id: 'league-partner-entry',
        event_id: 'league-withdraw-event',
        category: 'men',
        status: 'registered',
        display_name: 'Jordan Partner',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'league-event-pair',
        event_id: 'league-withdraw-event',
        category: 'men',
        player_one_id: 'league-own-entry',
        player_two_id: 'league-partner-entry',
        group_number: 1,
        seed: null,
        status: 'registered',
        player_one_name: 'Alex Member',
        player_two_name: 'Jordan Partner',
      },
    ];
    supabaseMocks.rpcData.event_tournament_my_entries = [
      {
        id: 'league-own-entry',
        category: 'men',
        payment_status: 'paid',
        amount_cents: 1500,
        display_name: 'Alex Member',
        confirmation_status: 'confirmed',
        partner_id: 'league-partner-entry',
        partner_name: 'Jordan Partner',
        partner_confirmation_status: 'confirmed',
        partner_is_league_team: true,
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="league-withdraw-event"
        currentUserId="league-member-one"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['men'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
        leagueTournament
        leagueId="league-1"
        leagueGender="male"
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    expect(
      await screen.findByRole('heading', { name: 'Withdraw your League team?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/remove you and your confirmed partner from this event/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Withdraw team' }));
    expect(
      await screen.findByText('You and your League partner have been withdrawn from this event.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/payments/cancel',
      expect.objectContaining({
        body: JSON.stringify({ participantIds: ['league-own-entry', 'league-partner-entry'] }),
      }),
    );
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'withdraw_league_event_team',
      args: { p_participant_id: 'league-own-entry' },
    });
  });

  it('renders public group standings, match results, and knockout brackets', async () => {
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'player-1',
        event_id: 'event-results',
        team_id: null,
        category: 'mixed',
        display_name: 'Alex Player',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
        tennis_skill_level: 4,
      },
      {
        id: 'player-2',
        event_id: 'event-results',
        team_id: null,
        category: 'mixed',
        display_name: 'Jordan Player',
        gender: 'female',
        status: 'registered',
        payment_status: 'paid',
        tennis_skill_level: 3.5,
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'pair-1',
        event_id: 'event-results',
        category: 'mixed',
        player_one_id: 'player-1',
        player_two_id: 'player-2',
        group_number: 1,
        seed: 1,
        status: 'registered',
        player_one_name: 'Alex Player',
        player_two_name: 'Jordan Player',
        player_one_skill_level: 4,
        player_two_skill_level: 3.5,
      },
      {
        id: 'pair-2',
        event_id: 'event-results',
        category: 'mixed',
        player_one_id: 'player-3',
        player_two_id: 'player-4',
        group_number: 1,
        seed: 2,
        status: 'registered',
        player_one_name: 'Sam Player',
        player_two_name: 'Casey Player',
      },
    ];
    supabaseMocks.data.tournament_group_overrides = [
      {
        event_id: 'event-results',
        category: 'mixed',
        group_number: 1,
        entry_id: 'pair-1',
        override_type: 'ranking',
        override_value: 2,
        reason: 'Corrected after a score review',
      },
      {
        event_id: 'event-results',
        category: 'mixed',
        group_number: 1,
        entry_id: 'pair-1',
        override_type: 'promotion',
        override_value: 0,
        reason: 'Keep pair one in groups',
      },
      {
        event_id: 'event-results',
        category: 'mixed',
        group_number: 1,
        entry_id: 'pair-2',
        override_type: 'promotion',
        override_value: 1,
        reason: 'Advance pair two',
      },
    ];
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'group-match',
        event_id: 'event-results',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: 'pair-2',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: '2027-06-01T12:00:00Z',
        court_number: 1,
        score_sets: [
          { one: 6, two: 3 },
          { one: 6, two: 4 },
        ],
        winner_side: 1,
        team_points_one: 0,
        team_points_two: 0,
        status: 'completed',
        team_one_name: null,
        team_two_name: null,
        player_one_name: 'Alex Player + Jordan Player',
        player_two_name: 'Sam Player + Casey Player',
        opponent_one_name: 'Sam Player + Casey Player',
        opponent_two_name: 'Alex Player + Jordan Player',
      },
      {
        id: 'final-match',
        event_id: 'event-results',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-1',
        pair_two_id: 'pair-2',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: '2027-06-01T16:00:00Z',
        court_number: 2,
        score_sets: [
          { one: 6, two: 2 },
          { one: 6, two: 1 },
        ],
        winner_side: 1,
        team_points_one: 0,
        team_points_two: 0,
        status: 'completed',
        team_one_name: null,
        team_two_name: null,
        player_one_name: 'Alex Player + Jordan Player',
        player_two_name: 'Sam Player + Casey Player',
        opponent_one_name: 'Sam Player + Casey Player',
        opponent_two_name: 'Alex Player + Jordan Player',
      },
      {
        id: 'bye-final-match',
        event_id: 'event-results',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 1,
        match_number: 2,
        pair_one_id: null,
        pair_two_id: 'pair-1',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [],
        winner_side: 2,
        team_points_one: 0,
        team_points_two: 0,
        status: 'bye',
        team_one_name: null,
        team_two_name: null,
        player_one_name: null,
        player_two_name: 'Alex Player + Jordan Player',
        opponent_one_name: null,
        opponent_two_name: 'Alex Player + Jordan Player',
      },
      {
        id: 'side-two-final-match',
        event_id: 'event-results',
        category: 'mixed',
        phase: 'final_knockout',
        group_number: null,
        round_number: 2,
        match_number: 1,
        pair_one_id: 'pair-2',
        pair_two_id: 'pair-1',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: '2027-06-01T18:00:00Z',
        court_number: 3,
        score_sets: [{ one: 2, two: 6 }],
        winner_side: 2,
        team_points_one: 0,
        team_points_two: 0,
        status: 'completed',
        team_one_name: null,
        team_two_name: null,
        player_one_name: 'Sam Player + Casey Player',
        player_two_name: 'Alex Player + Jordan Player',
        opponent_one_name: 'Alex Player + Jordan Player',
        opponent_two_name: 'Sam Player + Casey Player',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventTitle="Summer Open"
        eventId="event-results"
        currentUserId={null}
        format="doubles"
        config={{
          categories: ['mixed'],
          phases: { round_robin: true, final_knockout: true },
        }}
        rulesHtml="<p>Rules</p>"
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2027-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
      />,
    );

    await user.click(await screen.findByRole('tab', { name: /Groups, Schedule & Results/i }));
    expect(await screen.findByText('Group standings')).toBeInTheDocument();
    expect(screen.getAllByText('Alex Player + Jordan Player').length).toBeGreaterThan(1);
    expect(screen.getByText('Knockout bracket')).toBeInTheDocument();
    expect(screen.getByText('Final 1')).toBeInTheDocument();
    expect(screen.getAllByText('6').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Corrected after a score review')).toBeInTheDocument();
    expect(screen.getByText('Promoted')).toBeInTheDocument();
    expect(screen.getByText('BYE — automatic advancement')).toBeInTheDocument();
    expect(screen.getByText('Walkover — winner advances')).toBeInTheDocument();
  });

  it('renders team standings, points, and the signed-in player’s team result', async () => {
    supabaseMocks.data.tournament_public_teams = [
      {
        id: 'public-team-one',
        event_id: 'public-team-event',
        name: 'Baseline Crew',
        logo_url: null,
        color: 'Green',
        group_number: 1,
        captain_user_id: 'member-team',
        captain_name: 'Alex Captain',
      },
      {
        id: 'public-team-two',
        event_id: 'public-team-event',
        name: 'Court Rockets',
        logo_url: null,
        color: 'Blue',
        group_number: 1,
        captain_user_id: null,
        captain_name: null,
      },
    ];
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'team-player-one',
        event_id: 'public-team-event',
        team_id: 'public-team-one',
        category: 'team',
        display_name: 'Alex Captain',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'team-player-two',
        event_id: 'public-team-event',
        team_id: 'public-team-two',
        category: 'team',
        display_name: 'Jordan Rocket',
        gender: 'female',
        status: 'registered',
        payment_status: 'paid',
      },
    ];
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'public-team-result',
        event_id: 'public-team-event',
        category: 'team',
        phase: 'team_round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: null,
        pair_two_id: null,
        team_one_id: 'public-team-one',
        team_two_id: 'public-team-two',
        scheduled_at: '2027-06-01T14:00:00Z',
        court_number: 2,
        score_sets: [
          { one: 7, two: 5 },
          { one: 6, two: 4 },
        ],
        winner_side: 1,
        team_points_one: 3,
        team_points_two: 1,
        status: 'completed',
        team_one_name: 'Baseline Crew',
        team_two_name: 'Court Rockets',
        player_one_name: null,
        player_two_name: null,
      },
    ];
    supabaseMocks.rpcData.event_tournament_my_entries = [
      {
        id: 'team-player-one',
        category: 'team',
        payment_status: 'paid',
        amount_cents: 0,
        display_name: 'Alex Captain',
        team_id: 'public-team-one',
        confirmation_status: 'confirmed',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventTitle="Club Team Cup"
        eventId="public-team-event"
        eventSlug="club-team-cup"
        currentUserId="member-team"
        currentUserEmail="alex@example.test"
        currentUserPhone="604-555-0100"
        currentUserGender="male"
        currentUserSkillLevel="3.5"
        format="team"
        config={{
          categories: ['team'],
          group_count: 1,
          scoring_template: 'team_two_sets_bonus_third',
          phases: { team_round_robin: true, team_knockout: true },
        }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Main courts"
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={0}
      />,
    );

    expect(
      await screen.findByText('alex@example.test · 604-555-0100 · Male · Rating 3.5'),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('tab', { name: /Groups, Schedule & Results/i }));
    expect(await screen.findAllByText('Standings')).toHaveLength(2);
    expect(screen.getAllByText('Baseline Crew').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Court Rockets').length).toBeGreaterThan(0);
    expect(screen.getByText('Team standings points: 3 – 0')).toBeInTheDocument();
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
  });

  it('opens, reorders, validates, and saves an administrator standings override', async () => {
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'a',
        event_id: 'override-event',
        category: 'mixed',
        display_name: 'Alex',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'b',
        event_id: 'override-event',
        category: 'mixed',
        display_name: 'Blair',
        gender: 'female',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'c',
        event_id: 'override-event',
        category: 'mixed',
        display_name: 'Casey',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'd',
        event_id: 'override-event',
        category: 'mixed',
        display_name: 'Drew',
        gender: 'female',
        status: 'registered',
        payment_status: 'paid',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'pair-a',
        event_id: 'override-event',
        category: 'mixed',
        player_one_id: 'a',
        player_two_id: 'b',
        group_number: 1,
        seed: 1,
        status: 'registered',
        player_one_name: 'Alex + Blair',
        player_two_name: 'Casey + Drew',
      },
      {
        id: 'pair-b',
        event_id: 'override-event',
        category: 'mixed',
        player_one_id: 'c',
        player_two_id: 'd',
        group_number: 1,
        seed: 2,
        status: 'registered',
        player_one_name: 'Casey + Drew',
        player_two_name: 'Alex + Blair',
      },
    ];
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'group-result',
        event_id: 'override-event',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'pair-a',
        pair_two_id: 'pair-b',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [{ one: 6, two: 2 }],
        winner_side: 1,
        team_points_one: 0,
        team_points_two: 0,
        status: 'completed',
        player_one_name: 'Alex + Blair',
        player_two_name: 'Casey + Drew',
        opponent_one_name: 'Casey + Drew',
        opponent_two_name: 'Alex + Blair',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        adminContent={<div>Admin controls</div>}
        isManager
        eventId="override-event"
        currentUserId="admin-1"
        format="doubles"
        config={{
          categories: ['mixed'],
          phases: { round_robin: true, final_knockout: false },
          promoted_teams_per_group: 1,
        }}
        rulesHtml="<p>Rules</p>"
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={0}
      />,
    );
    await user.click(await screen.findByRole('tab', { name: /Groups, Schedule & Results/i }));
    await user.click(await screen.findByRole('button', { name: 'Override standings' }));
    await user.type(
      screen.getByPlaceholderText('Explain why the standings or promotion status changed.'),
      'Corrected result entry',
    );
    const moveUpButtons = screen.getAllByRole('button', { name: /Move .* up/ });
    await user.click(moveUpButtons[moveUpButtons.length - 1]);
    const promotedCheckboxes = screen.getAllByLabelText('Promoted');
    await user.click(promotedCheckboxes[promotedCheckboxes.length - 1]);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({ table: 'tournament_group_overrides', operation: 'upsert' }),
      ),
    );
    const overrideWrite = supabaseMocks.writes.find(
      (write) => write.table === 'tournament_group_overrides' && write.operation === 'upsert',
    );
    expect(overrideWrite?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ override_type: 'ranking', reason: 'Corrected result entry' }),
        expect.objectContaining({ override_type: 'promotion', reason: 'Corrected result entry' }),
      ]),
    );
  });

  it('closes an unchanged standings override without writing redundant rows', async () => {
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'override-a',
        event_id: 'override-noop',
        category: 'mixed',
        display_name: 'Alex',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'override-b',
        event_id: 'override-noop',
        category: 'mixed',
        display_name: 'Blair',
        gender: 'female',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'override-c',
        event_id: 'override-noop',
        category: 'mixed',
        display_name: 'Casey',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'override-d',
        event_id: 'override-noop',
        category: 'mixed',
        display_name: 'Drew',
        gender: 'female',
        status: 'registered',
        payment_status: 'paid',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'override-pair-a',
        event_id: 'override-noop',
        category: 'mixed',
        player_one_id: 'override-a',
        player_two_id: 'override-b',
        group_number: 1,
        seed: 1,
        status: 'registered',
        player_one_name: 'Alex + Blair',
        player_two_name: 'Casey + Drew',
      },
      {
        id: 'override-pair-b',
        event_id: 'override-noop',
        category: 'mixed',
        player_one_id: 'override-c',
        player_two_id: 'override-d',
        group_number: 1,
        seed: 2,
        status: 'registered',
        player_one_name: 'Casey + Drew',
        player_two_name: 'Alex + Blair',
      },
    ];
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'override-match',
        event_id: 'override-noop',
        category: 'mixed',
        phase: 'round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: 'override-pair-a',
        pair_two_id: 'override-pair-b',
        team_one_id: null,
        team_two_id: null,
        scheduled_at: null,
        court_number: null,
        score_sets: [{ one: 6, two: 3 }],
        winner_side: 1,
        team_points_one: 0,
        team_points_two: 0,
        status: 'completed',
      },
    ];
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        adminContent={<div>Admin controls</div>}
        isManager
        eventId="override-noop"
        currentUserId="admin-1"
        format="doubles"
        config={{
          categories: ['mixed'],
          phases: { round_robin: true, final_knockout: true },
          promoted_teams_per_group: 1,
        }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt={null}
        priceCents={0}
      />,
    );
    await user.click(await screen.findByRole('tab', { name: /Groups, Schedule & Results/i }));
    await user.click(await screen.findByRole('button', { name: 'Override standings' }));
    await user.type(
      screen.getByPlaceholderText('Explain why the standings or promotion status changed.'),
      'Document the unchanged decision',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(supabaseMocks.writes).not.toContainEqual(
      expect.objectContaining({ table: 'tournament_group_overrides', operation: 'upsert' }),
    );
  });

  it('shows a member their partner payment status, Interac instructions, and withdrawal result', async () => {
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'own-entry',
        event_id: 'event-member',
        team_id: null,
        category: 'mixed',
        display_name: 'Alex Member',
        gender: 'male',
        status: 'registered',
        payment_status: 'pending',
      },
      {
        id: 'partner-entry',
        event_id: 'event-member',
        team_id: null,
        category: 'mixed',
        display_name: 'Jordan Partner',
        gender: 'female',
        status: 'registered',
        payment_status: 'pending',
      },
    ];
    supabaseMocks.data.tournament_participants = [
      {
        id: 'own-entry',
        team_id: null,
        category: 'mixed',
        payment_status: 'pending',
        amount_cents: 1500,
      },
    ];
    supabaseMocks.rpcData.event_tournament_my_entries = [
      {
        id: 'own-entry',
        category: 'mixed',
        payment_status: 'pending',
        amount_cents: 1500,
        display_name: 'Alex Member',
        email: 'alex@example.test',
        confirmation_status: 'confirmed',
        partner_id: 'partner-entry',
        partner_name: 'Jordan Partner',
        partner_email: 'jordan@example.test',
        partner_confirmation_status: 'confirmed',
      },
    ];
    supabaseMocks.data.profiles = { gender: 'male' };
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'pair-member',
        event_id: 'event-member',
        category: 'mixed',
        player_one_id: 'own-entry',
        player_two_id: 'partner-entry',
        group_number: 1,
        seed: null,
        status: 'registered',
        player_one_name: 'Alex Member',
        player_two_name: 'Jordan Partner',
      },
    ];
    supabaseMocks.rpcData.event_tournament_partner_directory = [
      { id: 'partner-user', full_name: 'Jordan Partner', gender: 'female' },
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('pair-payment-status'))
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                pair_id: 'pair-member',
                player_one_id: 'own-entry',
                player_two_id: 'partner-entry',
                player_one_payment_status: 'pending',
                player_two_payment_status: 'pending',
              },
            ],
          }),
        };
      if (url === '/api/payments/cancel')
        return { ok: true, json: async () => ({ success: true }) };
      if (init?.method === 'POST')
        return {
          ok: true,
          json: async () => ({
            paymentId: 'interac-payment',
            amountMinor: 1500,
            recipientEmail: 'payments@example.test',
            instructions: 'Use your tournament entry as the reference.',
            message:
              'Interac request submitted. Your membership or event registration will be finalized after an administrator confirms receipt.',
          }),
        };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="event-member"
        currentUserId="member-1"
        format="doubles"
        config={{ categories: ['mixed', 'men', 'women'], registration_mode: 'both' }}
        rulesHtml="<p>Rules</p>"
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
        interacEnabled
      />,
    );

    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    await screen.findByText(/Payment pending · Partner: Jordan Partner · Partner confirmed/);
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    expect(screen.getByRole('menuitem', { name: /For both by card/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /For both by Interac/ })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /For myself by Interac/ }));
    expect(await screen.findByText('Interac e-Transfer instructions')).toBeInTheDocument();
    expect(screen.getByText('Use your tournament entry as the reference.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/payments/checkout',
      expect.objectContaining({ method: 'POST' }),
    );

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(await screen.findByText('Mixed doubles registration withdrawn.')).toBeInTheDocument();
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'withdraw_tournament_entry',
      args: { p_participant_id: 'own-entry' },
    });
  });

  it('shows each saved tournament payment state and fills missing profile details from the signed-in user', async () => {
    supabaseMocks.rpcData.event_tournament_my_entries = [
      ...[
        ['entry-paid', 'paid'],
        ['entry-free', 'not_required'],
        ['entry-refunded', 'refunded'],
        ['entry-failed', 'failed'],
        ['entry-pending', 'pending'],
      ].map(([id, payment_status]) => ({
        id,
        category: 'mixed',
        payment_status,
        amount_cents: 1200,
        confirmation_status: 'confirmed',
      })),
    ];
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventTitle="Payment states"
        eventId="payment-state-event"
        eventSlug="payment-states"
        currentUserId="member-payment-states"
        currentUserName="Alex Current Member"
        currentUserEmail="alex-current@example.test"
        currentUserPhone="604-555-0140"
        currentUserGender="male"
        currentUserSkillLevel="4.0"
        format="singles"
        config={{ categories: ['mixed'], registration_mode: 'individual' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration={false}
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1200}
      />,
    );

    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('No payment required')).toBeInTheDocument();
    expect(screen.getByText('Refunded')).toBeInTheDocument();
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    expect(screen.getByText('Payment pending')).toBeInTheDocument();
    expect(screen.getAllByText('Alex Current Member')).toHaveLength(5);
    expect(screen.getAllByText(/alex-current@example\.test/)).toHaveLength(5);
    expect(screen.getAllByText(/604-555-0140/)).toHaveLength(5);
    expect(screen.getAllByText(/Male/)).toHaveLength(5);
    expect(screen.getAllByText(/Rating 4.0/)).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: 'Pay' })).toHaveLength(3);
  });

  it('does not offer payment to a member until they confirm a guest-created pair entry', async () => {
    supabaseMocks.rpcData.event_tournament_my_entries = [
      {
        id: 'invited-member-entry',
        category: 'mixed',
        display_name: 'Invited Member',
        email: 'member@example.test',
        payment_status: 'pending',
        amount_cents: 1500,
        confirmation_status: 'pending',
        partner_id: 'guest-entry',
        partner_name: 'Guest Player',
        partner_email: 'guest@example.test',
        partner_confirmation_status: 'confirmed',
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="guest-invited-member-event"
        currentUserId="invited-member"
        currentUserName="Invited Member"
        currentUserEmail="member@example.test"
        currentUserGender="female"
        format="doubles"
        config={{ categories: ['mixed'], registration_mode: 'doubles' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
      />,
    );

    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText(/Awaiting your confirmation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm participation' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events/partner-confirmation',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ participantId: 'invited-member-entry' }),
      }),
    );
  });

  it('lets a player remove an unconfirmed partner and keep their own entry as a single', async () => {
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'own-pending',
        event_id: 'event-edit-partner',
        category: 'mixed',
        display_name: 'Alex Player',
        gender: 'male',
        status: 'registered',
        payment_status: 'pending',
      },
      {
        id: 'partner-pending',
        event_id: 'event-edit-partner',
        category: 'mixed',
        display_name: 'Jordan Guest',
        gender: 'female',
        status: 'registered',
        payment_status: 'pending',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'pair-pending',
        event_id: 'event-edit-partner',
        category: 'mixed',
        player_one_id: 'own-pending',
        player_two_id: 'partner-pending',
        group_number: 1,
        seed: null,
        status: 'registered',
        player_one_name: 'Alex Player',
        player_two_name: 'Jordan Guest',
      },
    ];
    supabaseMocks.rpcData.event_tournament_my_entries = [
      {
        id: 'own-pending',
        category: 'mixed',
        payment_status: 'pending',
        amount_cents: 1500,
        display_name: 'Alex Player',
        confirmation_status: 'confirmed',
        partner_id: 'partner-pending',
        partner_name: 'Jordan Guest',
        partner_email: 'jordan@example.com',
        partner_confirmation_status: 'pending',
      },
    ];
    supabaseMocks.data.profiles = { gender: 'male' };
    supabaseMocks.rpcErrors.remove_unconfirmed_tournament_partner = {
      message: 'Partner was not updated.',
    };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="event-edit-partner"
        currentUserId="member-1"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['mixed'], registration_mode: 'both' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
      />,
    );
    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Register as a single' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Partner was not updated.');
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'remove_unconfirmed_tournament_partner',
      args: { p_participant_id: 'own-pending' },
    });
  });

  it('updates pending partner details and requests a new partner confirmation', async () => {
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'own-edit',
        event_id: 'event-partner-edit',
        category: 'mixed',
        display_name: 'Alex Player',
        gender: 'male',
        status: 'registered',
        payment_status: 'pending',
      },
      {
        id: 'partner-old',
        event_id: 'event-partner-edit',
        category: 'mixed',
        display_name: 'Jordan Guest',
        gender: 'female',
        status: 'registered',
        payment_status: 'pending',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'pair-edit',
        event_id: 'event-partner-edit',
        category: 'mixed',
        player_one_id: 'own-edit',
        player_two_id: 'partner-old',
        group_number: 1,
        seed: null,
        status: 'registered',
        player_one_name: 'Alex Player',
        player_two_name: 'Jordan Guest',
      },
    ];
    supabaseMocks.rpcData.event_tournament_my_entries = [
      {
        id: 'own-edit',
        category: 'mixed',
        payment_status: 'pending',
        amount_cents: 1500,
        display_name: 'Alex Player',
        confirmation_status: 'confirmed',
        partner_id: 'partner-old',
        partner_name: 'Jordan Guest',
        partner_email: 'jordan@example.com',
        partner_confirmation_status: 'pending',
      },
    ];
    supabaseMocks.rpcData.update_unconfirmed_tournament_partner = {
      partnerParticipantId: 'partner-new',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="event-partner-edit"
        currentUserId="member-1"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['mixed'], registration_mode: 'both' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
      />,
    );
    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Change partner' }));
    await user.clear(screen.getByLabelText('Partner name'));
    await user.type(screen.getByLabelText('Partner name'), 'Casey New');
    await user.clear(screen.getByLabelText('Partner email'));
    await user.type(screen.getByLabelText('Partner email'), 'casey@example.com');
    await user.click(screen.getByRole('button', { name: 'Save and invite' }));
    expect(
      await screen.findByText(/Partner updated. The new partner must confirm/),
    ).toBeInTheDocument();
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'update_unconfirmed_tournament_partner',
      args: expect.objectContaining({
        p_participant_id: 'own-edit',
        p_partner_name: 'Casey New',
        p_partner_email: 'casey@example.com',
      }),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events/partner-invitations',
      expect.objectContaining({ body: JSON.stringify({ participantIds: ['partner-new'] }) }),
    );
  });

  it('allows a verified guest to edit the event-specific registration details', async () => {
    supabaseMocks.rpcData.event_tournament_my_entries = [
      {
        id: 'guest-own-entry',
        category: 'mixed',
        payment_status: 'pending',
        amount_cents: 1500,
        display_name: 'Taylor Guest',
        email: 'taylor@example.com',
        phone: '604-555-0100',
        gender: 'female',
        tennis_skill_level: 3.5,
        confirmation_status: 'confirmed',
      },
    ];
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'guest-own-entry',
        event_id: 'guest-edit-event',
        category: 'mixed',
        display_name: 'Taylor Guest',
        gender: 'female',
        status: 'registered',
        payment_status: 'pending',
      },
    ];
    supabaseMocks.rpcData.update_event_guest_registration_details = {};
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="guest-edit-event"
        currentUserId="guest-session"
        currentUserAccountKind="event_guest"
        currentUserEmail="taylor@example.com"
        currentUserName="Taylor Guest"
        format="doubles"
        config={{ categories: ['mixed'], registration_mode: 'individual' }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={1500}
      />,
    );
    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Edit my details' }));
    await user.clear(screen.getByLabelText('Your name'));
    await user.type(screen.getByLabelText('Your name'), 'Taylor Updated');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your event registration details were updated.',
    );
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'update_event_guest_registration_details',
      args: expect.objectContaining({
        p_participant_id: 'guest-own-entry',
        p_display_name: 'Taylor Updated',
        p_phone: '604-555-0100',
      }),
    });
  });

  it('selects the nearest upcoming match for the signed-in player', async () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'next-own',
        event_id: 'next-event',
        category: 'mixed',
        display_name: 'Alex',
        gender: 'male',
        status: 'registered',
      },
      {
        id: 'next-other',
        event_id: 'next-event',
        category: 'mixed',
        display_name: 'Jordan',
        gender: 'female',
        status: 'registered',
      },
    ];
    supabaseMocks.data.tournament_public_pairs = [
      {
        id: 'pair-own',
        event_id: 'next-event',
        category: 'mixed',
        player_one_id: 'next-own',
        player_two_id: 'next-other',
        group_number: 1,
        status: 'registered',
        player_one_name: 'Alex + Jordan',
      },
      {
        id: 'pair-withdrawn',
        event_id: 'next-event',
        category: 'mixed',
        player_one_id: 'another-one',
        player_two_id: 'another-two',
        group_number: 1,
        status: 'withdrawn',
        player_one_name: 'Withdrawn pair',
      },
    ];
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'next-past-match',
        event_id: 'next-event',
        category: 'mixed',
        phase: 'round_robin',
        pair_one_id: 'pair-own',
        pair_two_id: 'other-pair',
        status: 'scheduled',
        scheduled_at: past,
        player_one_name: 'Past match',
      },
      {
        id: 'next-match',
        event_id: 'next-event',
        category: 'mixed',
        phase: 'round_robin',
        pair_one_id: 'pair-own',
        pair_two_id: 'other-pair',
        status: 'scheduled',
        scheduled_at: future,
        court_number: 2,
        player_one_name: 'Alex + Jordan',
        opponent_one_name: 'Casey + Drew',
      },
      {
        id: 'later-match',
        event_id: 'next-event',
        category: 'mixed',
        phase: 'round_robin',
        pair_one_id: 'pair-own',
        pair_two_id: 'other-pair',
        status: 'scheduled',
        scheduled_at: later,
        player_one_name: 'Later match',
      },
      {
        id: 'withdrawn-match',
        event_id: 'next-event',
        category: 'mixed',
        phase: 'round_robin',
        pair_one_id: 'pair-withdrawn',
        pair_two_id: 'other-pair',
        status: 'scheduled',
        scheduled_at: future,
        player_one_name: 'Withdrawn match',
      },
    ];
    supabaseMocks.rpcData.event_tournament_my_entries = [
      { id: 'next-own', category: 'mixed', payment_status: 'paid', display_name: 'Alex' },
    ];
    supabaseMocks.data.profiles = { gender: 'male' };
    render(
      <TournamentPublicView
        eventId="next-event"
        currentUserId="member-next"
        currentUserGender="male"
        format="doubles"
        config={{ categories: ['mixed'], phases: { round_robin: true } }}
        rulesHtml={null}
        detailsPublic
        allowNonMemberRegistration
        eventStatus="published"
        startsAt={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}
        endsAt={null}
        locationQuery=""
        registrationOpensAt="2026-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={0}
      />,
    );
    expect(await screen.findByText('Your next match')).toBeInTheDocument();
    expect(screen.getByText('Your next match').parentElement).toHaveTextContent(
      /Alex.*Jordan.*vs.*Casey \+ Drew/,
    );
    expect(screen.getByText(/Court 2/)).toBeInTheDocument();
  });

  it('shows an invitation loading error and leaves failed partner confirmation available', async () => {
    window.history.replaceState({}, '', '/events/invite?confirm_partner=missing-entry');
    const failedLoadFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'This invitation expired.' }),
    });
    vi.stubGlobal('fetch', failedLoadFetch);
    const props = {
      eventId: 'event-invite-error',
      currentUserId: 'member-invited',
      format: 'doubles' as const,
      config: { categories: ['mixed'], registration_mode: 'doubles' as const },
      rulesHtml: null,
      detailsPublic: true,
      allowNonMemberRegistration: true,
      eventStatus: 'published',
      startsAt: '2027-06-01T12:00:00Z',
      endsAt: '2027-06-01T20:00:00Z',
      locationQuery: '',
      registrationOpensAt: '2026-01-01T00:00:00Z',
      registrationClosesAt: '2027-05-31T23:00:00Z',
      priceCents: 1500,
    };
    const first = render(<TournamentPublicView {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation expired.');
    first.unmount();

    window.history.replaceState({}, '', '/events/invite?confirm_partner=invitee-entry');
    const failedConfirmFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/events/partner-confirmation?')) {
        return {
          ok: true,
          json: async () => ({
            participant: { displayName: 'Taylor Invitee', email: 'taylor@example.com' },
            event: { title: 'Mixed Doubles' },
            invitedBy: 'Alex Member',
          }),
        } as Response;
      }
      if (String(input) === '/api/events/partner-confirmation' && init?.method === 'POST') {
        return {
          ok: false,
          json: async () => ({ error: 'Confirmation is no longer available.' }),
        } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    });
    vi.stubGlobal('fetch', failedConfirmFetch);
    const user = userEvent.setup();
    render(<TournamentPublicView {...props} />);
    await user.click(await screen.findByRole('button', { name: 'Confirm participation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Confirmation is no longer available.',
    );
  });

  it('lets a team captain use the Matches interface to save their lineup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );
    supabaseMocks.data.tournament_public_teams = [
      {
        id: 'team-a',
        event_id: 'captain-event',
        name: 'Aces',
        color: 'Blue',
        group_number: 1,
        captain_user_id: 'member-1',
        captain_name: 'Alex Captain',
      },
      {
        id: 'team-b',
        event_id: 'captain-event',
        name: 'Rockets',
        color: 'Red',
        group_number: 1,
        captain_user_id: 'member-2',
        captain_name: 'Casey Captain',
      },
    ];
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'a1',
        event_id: 'captain-event',
        team_id: 'team-a',
        category: 'team',
        display_name: 'Alex One',
        user_id: 'member-1',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'a2',
        event_id: 'captain-event',
        team_id: 'team-a',
        category: 'team',
        display_name: 'Blair Two',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'b1',
        event_id: 'captain-event',
        team_id: 'team-b',
        category: 'team',
        display_name: 'Casey Three',
        user_id: 'member-2',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'b2',
        event_id: 'captain-event',
        team_id: 'team-b',
        category: 'team',
        display_name: 'Drew Four',
        gender: 'male',
        status: 'registered',
        payment_status: 'paid',
      },
    ];
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'captain-match',
        event_id: 'captain-event',
        category: 'men',
        phase: 'team_round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 1,
        pair_one_id: null,
        pair_two_id: null,
        team_one_id: 'team-a',
        team_two_id: 'team-b',
        scheduled_at: null,
        court_number: 1,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        player_one_name: 'Aces',
        player_two_name: 'Rockets',
      },
      {
        id: 'unrelated-match',
        event_id: 'captain-event',
        category: 'men',
        phase: 'team_round_robin',
        group_number: 1,
        round_number: 1,
        match_number: 2,
        pair_one_id: null,
        pair_two_id: null,
        team_one_id: 'team-c',
        team_two_id: 'team-d',
        scheduled_at: null,
        court_number: 2,
        score_sets: [],
        winner_side: null,
        team_points_one: 0,
        team_points_two: 0,
        status: 'scheduled',
        player_one_name: 'Other Aces',
        player_two_name: 'Other Rockets',
      },
    ];
    supabaseMocks.rpcData.event_tournament_visible_match_lineups = [];
    const user = userEvent.setup();
    render(
      <TournamentManagement
        eventId="captain-event"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="team"
        config={{
          categories: ['men'],
          phases: { team_round_robin: true },
          scoring_templates: { team_round_robin: 'one_set' },
        }}
        priceCents={0}
        captainMode
        captainTeamId="team-a"
      />,
    );
    expect(await screen.findByText(/Aces vs Rockets/)).toBeInTheDocument();
    expect(screen.queryByText(/Other Aces vs Other Rockets/)).not.toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('Choose player one')).toHaveLength(1);
    expect(screen.queryByPlaceholderText('Choose side one')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest schedule' })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="datetime-local"]')).not.toBeInTheDocument();
    expect(document.querySelector('select')).not.toBeInTheDocument();

    await user.click(screen.getByPlaceholderText('Choose player one'));
    await user.click(screen.getByRole('option', { name: /Alex One/ }));
    await user.click(screen.getByPlaceholderText('Choose player two'));
    await user.click(screen.getByRole('option', { name: /Blair Two/ }));
    await user.click(screen.getByRole('button', { name: 'Save lineup' }));
    await waitFor(() =>
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'save_tournament_captain_match_lineup',
        args: expect.objectContaining({
          p_match_id: 'captain-match',
          p_team_id: 'team-a',
          p_player_one: 'a1',
          p_player_two: 'a2',
        }),
      }),
    );

    cleanup();
    supabaseMocks.data.tournament_teams = supabaseMocks.data.tournament_public_teams;
    supabaseMocks.data.tournament_participants = supabaseMocks.data.tournament_public_participants;
    supabaseMocks.data.tournament_matches = (
      supabaseMocks.data.tournament_public_matches as Array<{ id: string }>
    ).filter((match) => match.id === 'captain-match');
    supabaseMocks.data.tournament_match_players = [];
    supabaseMocks.writes = [];
    render(
      <TournamentManagement
        eventId="captain-event"
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
        courtCount={2}
        format="team"
        config={{ categories: ['men'], phases: { team_round_robin: true } }}
        priceCents={0}
      />,
    );
    await screen.findByRole('heading', { name: 'Participants' });
    window.dispatchEvent(
      new CustomEvent('pctc-tournament-tab-change', { detail: { tab: 'matches' } }),
    );
    await screen.findAllByText(/Aces vs Rockets/);
    const firstPlayerSelectors = screen.getAllByPlaceholderText('Choose player one');
    const secondPlayerSelectors = screen.getAllByPlaceholderText('Choose player two');
    expect(firstPlayerSelectors).toHaveLength(2);
    await user.click(firstPlayerSelectors[1]);
    await user.click(screen.getByRole('option', { name: /Casey Three/ }));
    await user.click(secondPlayerSelectors[1]);
    await user.click(screen.getByRole('option', { name: /Drew Four/ }));
    await user.click(screen.getAllByRole('button', { name: 'Save lineup' })[1]);
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_match_players',
          operation: 'insert',
          values: expect.arrayContaining([
            expect.objectContaining({ participant_id: 'b1', team_id: 'team-b', side: 2 }),
            expect.objectContaining({ participant_id: 'b2', team_id: 'team-b', side: 2 }),
          ]),
        }),
      ),
    );
  });
});

describe('shared tournament administration tabs', () => {
  it('shows management tabs alongside public tabs only when management content is provided', async () => {
    render(
      <TournamentPublicView
        adminContent={<div data-testid="admin-slot">Admin content</div>}
        isManager
        eventId="event-admin"
        currentUserId="admin-1"
        format="doubles"
        config={{ categories: ['mixed', 'men'], phases: { round_robin: true } }}
        rulesHtml="<p>Rules</p>"
        detailsPublic
        eventStatus="published"
        allowNonMemberRegistration={false}
        startsAt="2027-06-01T12:00:00Z"
        endsAt="2027-06-01T20:00:00Z"
        locationQuery="Port Coquitlam, BC"
        registrationOpensAt="2027-01-01T00:00:00Z"
        registrationClosesAt="2027-05-31T23:00:00Z"
        priceCents={0}
      />,
    );
    expect(await screen.findByRole('tab', { name: 'Participants' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Matches' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Audit log' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Participants' }));
    expect(screen.getByTestId('admin-slot')).toBeInTheDocument();
  });
});
