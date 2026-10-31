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
            ? (supabaseMocks.data[`${table}.insert`] ?? [])
            : (supabaseMocks.data[table] ?? []),
        error: supabaseMocks.errors[`${table}.${operation}`] ?? supabaseMocks.errors[table] ?? null,
      });
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit']) {
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
      query.maybeSingle = async () => result();
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

import { TournamentRulesEditor } from '@/components/tournament-rules-editor';
import { TournamentManagement } from '@/components/tournament-management';
import { TournamentPublicView } from '@/components/tournament-public-view';
import { PublicOrganizerContacts } from '@/components/public-organizer-contacts';

afterEach(() => {
  cleanup();
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
  it('renders the rules editor with formatting controls and a vertically resizable content area', () => {
    const onChange = vi.fn();
    const { container } = render(
      <TournamentRulesEditor value="<p>Rules</p>" onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
    expect(container.querySelector('.resize-y')).toBeInTheDocument();
    for (const name of ['Bold', 'Italic', 'Underline', 'Heading', 'Bullets', 'Numbers'])
      screen.getByRole('button', { name }).click();
    tiptapMocks.options?.onUpdate?.({ editor: { getHTML: () => '<p>Updated rules</p>' } });
    expect(onChange).toHaveBeenCalledWith('<p>Updated rules</p>');
  });
  describe('public tournament contact and registration workflows', () => {
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
      supabaseMocks.rpcData.register_tournament_entry = {
        participantId: 'guest-entry-1',
        amountCents: 0,
      };
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-guest"
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

      await screen.findByRole('tab', { name: 'Overview' });
      await user.type(screen.getByLabelText('Your full name'), 'Taylor Guest');
      await user.type(screen.getByLabelText('Your email'), 'taylor@example.com');
      await user.selectOptions(screen.getByLabelText('Gender (optional)'), 'female');
      await user.selectOptions(screen.getByLabelText('Tennis skill level (optional)'), '4.0');
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

      expect(await screen.findByText('Registration confirmed.')).toBeInTheDocument();
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'register_tournament_entry',
        args: expect.objectContaining({
          p_event_id: 'event-guest',
          p_category: 'mixed',
          p_display_name: 'Taylor Guest',
          p_email: 'taylor@example.com',
          p_gender: 'female',
          p_tennis_skill_level: 4,
        }),
      });
    });

    it('creates provisional guest partner entries and reports checkout failures safely', async () => {
      supabaseMocks.rpcData.register_tournament_entry = {
        participantId: 'guest-entry-2',
        partnerParticipantId: 'guest-partner-2',
        amountCents: 2500,
        paymentStatus: 'pending',
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Checkout is unavailable.' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-guest-pair"
          currentUserId={null}
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
      await user.type(screen.getByLabelText('Your email'), 'taylor@example.com');
      await user.type(screen.getByLabelText('Partner name'), 'Morgan Guest');
      await user.type(screen.getByLabelText('Partner email'), 'morgan@example.com');
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));
      expect(
        await screen.findByText(
          'Provisional registration created. Complete card payment to confirm your entry.',
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Pay by card' }));
      expect(await screen.findByText('Checkout is unavailable.')).toBeInTheDocument();
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
        purpose: 'tournament_registration',
        businessRecordId: 'guest-entry-2',
        returnTo: '/?guest_payment_ids=guest-entry-2%2Cguest-partner-2',
      });
    });

    it('validates matching known genders before creating a guest mixed pair', async () => {
      const user = userEvent.setup();
      render(
        <TournamentPublicView
          eventId="event-gender-validation"
          currentUserId={null}
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
      await user.type(screen.getByLabelText('Your full name'), 'Taylor Guest');
      await user.type(screen.getByLabelText('Your email'), 'taylor@example.com');
      await user.selectOptions(screen.getByLabelText('Gender (optional)'), 'male');
      await user.type(screen.getByLabelText('Partner name'), 'Morgan Guest');
      await user.type(screen.getByLabelText('Partner email'), 'morgan@example.com');
      await user.selectOptions(screen.getByLabelText('Partner gender (optional)'), 'male');
      await user.click(screen.getByRole('button', { name: 'Register for tournament' }));

      expect(
        await screen.findByText(/Mixed doubles requires one male and one female player/),
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
      expect(await screen.findByText('Registration confirmed.')).toBeInTheDocument();
      expect(supabaseMocks.rpcArgs).toContainEqual({
        name: 'register_tournament_entry',
        args: expect.objectContaining({
          p_event_id: 'event-member-registration',
          p_partner_user_id: 'partner-user',
        }),
      });
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
    expect(await screen.findByText('Tournament audit log (2 recent changes)')).toBeInTheDocument();
    expect(screen.getByText('Tournament record', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('Club administrator', { exact: false })).toHaveLength(2);
    expect(screen.getByText('Name: Old name')).toBeInTheDocument();
    expect(screen.getByText(/Set scores: 6-3/)).toBeInTheDocument();
    expect(screen.getByText(/Scheduled for:/)).toBeInTheDocument();
    expect(screen.getByText('Something happened · Custom entity')).toBeInTheDocument();
  });

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
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_pairs',
          operation: 'insert',
          values: expect.objectContaining({
            category: 'mixed',
            player_one_id: 'player-1',
            player_two_id: 'player-2',
          }),
        }),
      ),
    );
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
        id: 'future-match',
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

    await screen.findByText('Registered participants (3)');
    await user.click(screen.getByLabelText('Actions for Alex Player and Jordan Player'));
    await user.click(screen.getByRole('button', { name: 'Replace Alex Player' }));
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
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({ table: 'tournament_match_players', operation: 'delete' }),
    );
    expect(supabaseMocks.writes).toContainEqual(
      expect.objectContaining({
        table: 'tournament_match_players',
        operation: 'insert',
        values: expect.arrayContaining([
          expect.objectContaining({ match_id: 'future-match', participant_id: 'player-3' }),
        ]),
      }),
    );
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
        eventStartsAt="2027-06-01T12:00:00Z"
        eventEndsAt="2027-06-01T20:00:00Z"
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
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_teams',
          operation: 'insert',
          values: expect.objectContaining({ name: 'Team Three', color: 'Red' }),
        }),
      ),
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
        category: 'team',
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
        category: 'team',
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
        config={{ categories: ['team'], phases: { team_round_robin: true } }}
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
    await user.click(screen.getAllByRole('button', { name: 'Save pairing' })[0]);
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

  it('renders the public tournament tabs and loads only public competition views for anonymous visitors', async () => {
    render(
      <TournamentPublicView
        eventId="event-1"
        currentUserId={null}
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

  it('reports rejected public registrations and clears errors when a retry starts', async () => {
    supabaseMocks.rpcErrors.register_tournament_entry = { message: 'Registration is closed.' };
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="event-registration-error"
        currentUserId={null}
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
    await user.type(screen.getByLabelText('Your email'), 'taylor@example.test');
    await user.click(await screen.findByRole('button', { name: 'Register for tournament' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration is closed.');
    expect(supabaseMocks.rpcArgs).toContainEqual(
      expect.objectContaining({ name: 'register_tournament_entry' }),
    );
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
    await screen.findByText('Payment pending · Partner: Jordan Partner · Team payment: Pending');
    await user.click(screen.getByRole('button', { name: 'Pay by Interac' }));
    expect(await screen.findByText('Interac e-Transfer instructions')).toBeInTheDocument();
    expect(screen.getByText('Use your tournament entry as the reference.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/payments/checkout',
      expect.objectContaining({ method: 'POST' }),
    );

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('Mixed doubles registration withdrawn.')).toBeInTheDocument();
    expect(supabaseMocks.rpcArgs).toContainEqual({
      name: 'withdraw_tournament_entry',
      args: { p_participant_id: 'own-entry' },
    });
  });

  it('lets team captains submit both doubles pairings and save a team result', async () => {
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
        captain_user_id: 'member-1',
        captain_name: 'Alex Captain',
      },
    ];
    supabaseMocks.data.tournament_public_participants = [
      {
        id: 'a1',
        event_id: 'captain-event',
        team_id: 'team-a',
        category: 'team',
        display_name: 'Alex One',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'a2',
        event_id: 'captain-event',
        team_id: 'team-a',
        category: 'team',
        display_name: 'Blair Two',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'b1',
        event_id: 'captain-event',
        team_id: 'team-b',
        category: 'team',
        display_name: 'Casey Three',
        status: 'registered',
        payment_status: 'paid',
      },
      {
        id: 'b2',
        event_id: 'captain-event',
        team_id: 'team-b',
        category: 'team',
        display_name: 'Drew Four',
        status: 'registered',
        payment_status: 'paid',
      },
    ];
    supabaseMocks.data.tournament_public_matches = [
      {
        id: 'captain-match',
        event_id: 'captain-event',
        category: 'team',
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
    ];
    const user = userEvent.setup();
    render(
      <TournamentPublicView
        eventId="captain-event"
        currentUserId="member-1"
        format="team"
        config={{
          categories: ['team'],
          phases: { team_round_robin: true },
          scoring_templates: { team_round_robin: 'one_set' },
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
    const selectFirstA = document.getElementById(
      'captain-pair-captain-match-1-a',
    ) as HTMLSelectElement;
    const selectSecondA = document.getElementById(
      'captain-pair-captain-match-1-b',
    ) as HTMLSelectElement;
    await user.selectOptions(selectFirstA, 'a1');
    await user.selectOptions(selectSecondA, 'a2');
    await user.click(screen.getAllByRole('button', { name: 'Save pairing' })[0]);
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({ table: 'tournament_match_players', operation: 'insert' }),
      ),
    );

    await user.selectOptions(
      document.getElementById('captain-pair-captain-match-2-a') as HTMLSelectElement,
      'b1',
    );
    await user.selectOptions(
      document.getElementById('captain-pair-captain-match-2-b') as HTMLSelectElement,
      'b2',
    );
    await user.click(screen.getAllByRole('button', { name: 'Save pairing' })[1]);
    await user.type(screen.getByPlaceholderText('6-4, 3-6, 10-8'), '6-2');
    await user.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() =>
      expect(supabaseMocks.writes).toContainEqual(
        expect.objectContaining({
          table: 'tournament_matches',
          operation: 'update',
          values: expect.objectContaining({ score_sets: [{ one: 6, two: 2 }], winner_side: 1 }),
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
