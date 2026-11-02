import Link from 'next/link';
import { ArrowRight, CircleHelp, Info } from 'lucide-react';
import type { HelpGuide } from '@/lib/help-access';

type HelpCenterProps = { guide: HelpGuide };

function Topic({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <article id={id} className="scroll-mt-28 rounded-xl border border-border bg-card p-5 sm:p-7">
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      {intro && <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{intro}</p>}
      <div className="mt-5 space-y-5 text-sm leading-6">{children}</div>
    </article>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-primary">
      {children}
    </ol>
  );
}

function FieldTable({ rows }: { rows: Array<{ field: string; value: string; effect: string }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[42rem] text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Input</th>
            <th className="px-3 py-2.5 font-semibold">What to enter</th>
            <th className="px-3 py-2.5 font-semibold">What it changes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.field} className="align-top">
              <th scope="row" className="px-3 py-3 font-medium">
                {row.field}
              </th>
              <td className="px-3 py-3 text-muted-foreground">{row.value}</td>
              <td className="px-3 py-3 text-muted-foreground">{row.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-3 text-sm leading-6">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function SectionNav({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label="Help guide contents" className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

export function HelpCenter({ guide }: HelpCenterProps) {
  const titles: Record<HelpGuide, string> = {
    public: 'Public guide',
    member: 'Member guide',
    organizer: 'Organizer guide',
    admin: 'Admin guide',
  };
  const descriptions: Record<HelpGuide, string> = {
    public:
      'Find public events, understand eligibility and registration, and enter tournaments that allow guest registration.',
    member:
      'Manage the profile details, event entries, competition participation, and payments attached to your member account.',
    organizer:
      'Configure events and competitions, then manage entries, draws, courts, and results for events you own or were assigned.',
    admin:
      'Manage club-wide events, member access, payments, membership plans, publications, and documents.',
  };
  const sectionLinks: Record<HelpGuide, Array<{ href: string; label: string }>> = {
    public: [
      { href: '#visitor-events', label: 'Browse events and eligibility' },
      { href: '#visitor-tournament', label: 'Public tournament registration' },
    ],
    member: [
      { href: '#member-profile', label: 'Profile and eligibility' },
      { href: '#member-events', label: 'Event registration' },
      { href: '#member-competitions', label: 'Tournament, League, ladder entry' },
      { href: '#member-payments', label: 'Membership and payments' },
      { href: '#member-results', label: 'Results and match scores' },
      { href: '#member-rankings', label: 'Club rankings' },
      { href: '#member-resources', label: 'Gallery and documents' },
      { href: '#member-chat', label: 'Member chat' },
    ],
    organizer: [
      { href: '#organizer-dashboard', label: 'Organizer dashboard' },
      { href: '#organizer-event-setup', label: 'Event form: every input' },
      { href: '#organizer-competitions', label: 'Tournament, League, ladder setup' },
      { href: '#organizer-running', label: 'Participants, courts, and results' },
    ],
    admin: [
      { href: '#admin-dashboard', label: 'Admin dashboard' },
      { href: '#admin-event-setup', label: 'Event ownership and assignment' },
      { href: '#admin-competition-setup', label: 'Competition oversight' },
      { href: '#admin-ranking-controls', label: 'How standings are maintained' },
      { href: '#admin-payments', label: 'Payments and refunds' },
      { href: '#admin-members', label: 'Applications and membership' },
      { href: '#admin-publishing', label: 'Website and documents' },
    ],
  };

  return (
    <div className="page-container flex-1 py-10 sm:py-14">
      <header className="mb-9 rounded-2xl border border-border bg-card p-6 sm:p-9">
        <p className="eyebrow">PCTC Help</p>
        <h1 className="section-title mt-2">{titles[guide]}</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
          {descriptions[guide]}
        </p>
        <div className="mt-6">
          <SectionNav links={sectionLinks[guide]} />
        </div>
      </header>

      {guide === 'public' && (
        <section id="public-guide" className="scroll-mt-24 space-y-4">
          <div className="max-w-3xl">
            <p className="eyebrow">For everyone</p>
            <h2 className="text-2xl font-semibold tracking-tight">Public and event visitors</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Public event pages show the published event information, registration window, cost,
              restrictions, and any tournament details the organizer has chosen to publish.
            </p>
          </div>
          <div className="space-y-4">
            <Topic
              id="visitor-events"
              title="Browse an event and understand registration"
              intro="Before pressing Register, check these details on the event page:"
            >
              <FieldTable
                rows={[
                  {
                    field: 'Registration opens / cutoff',
                    value: 'The date and time shown for that event.',
                    effect:
                      'Registration is accepted only inside the displayed window. A waitlist may be available if the organizer enabled it.',
                  },
                  {
                    field: 'Gender/category',
                    value:
                      'The event may limit entrants to a gender, or a tournament may offer one or more of the gender categories to participate: Mixed, Men’s, or Women’s.',
                    effect: 'Your profile gender is checked against gender-specific categories. ',
                  },
                  {
                    field: 'Cost',
                    value:
                      'If event participation is paid, the cost per person will be shown on the event page.',
                    effect:
                      'Paid registration remains pending until payment is confirmed; waitlisted registrations are not charged until they are confirmed and moved off the waitlist.',
                  },
                ]}
              />
              <Steps>
                <li>
                  Open <LinkButton href="/events">Events</LinkButton> and select the event to see
                  its complete description and registration controls.
                </li>
                <li>
                  Sign in and complete the registration action while registration is open. Regular
                  social event registrations require an approved account; some tournament pages
                  allow public guest registration when the organizer enabled it.
                </li>
                <li>
                  After registering, check the page for Registered, Waitlisted, payment status, and
                  any partner or team details.
                </li>
                <li>
                  Use the event page’s withdrawal action before its cutoff. If you registered a
                  tournament as a team, the confirmation explains that both partners will be
                  withdrawn together.
                </li>
              </Steps>
            </Topic>
          </div>
          <Topic
            id="visitor-tournament"
            title="Register for a public doubles tournament"
            intro="Some tournaments may allow registration without the member account."
          >
            <FieldTable
              rows={[
                {
                  field: 'Category',
                  value: 'Choose one of the enabled tournament categories.',
                  effect:
                    'A category may have its own capacity. Your gender and your partner’s gender are checked against it.',
                },
                {
                  field: 'Registration type',
                  value:
                    'If the organizer enabled both modes, choose to register individually or as a doubles pair.',
                  effect:
                    'Individual entries can be paired by the organizer. Pair registration automatically registers the partner and reserves your double team.',
                },
                {
                  field: 'Your name and email',
                  value: 'Required for a guest without an account.',
                  effect:
                    'They identify your provisional entry and let you receive event/payment correspondence.',
                },
                {
                  field: 'Phone, skill, and gender',
                  value: 'Phone, skill rating, and gender are optional for guest entries.',
                  effect:
                    'The skill rating appears with tournament participant/pair details when those details are displayed. Gender affects gender-specific and mixed-pair eligibility.',
                },
                {
                  field: 'Partner',
                  value:
                    'Choose a registered member or enter a new partner’s name and email; phone, skill, and gender are optional fields where shown.',
                  effect:
                    'The partner must satisfy the same category rules. With both genders known, Mixed doubles requires one male and one female.',
                },
              ]}
            />
            <Steps>
              <li>
                Choose the event category and registration mode first. If you are signing in as an
                approved member, use the member search to select a partner; a guest enters the
                partner’s contact details.
              </li>
              <li>
                Review names, email, partner, category, and the price before submitting. For a paid
                guest registration the app creates a provisional entry, then asks you to complete
                Stripe Checkout.
              </li>
              <li>
                Finish checkout and wait for the return page to verify payment. The entry is not
                treated as paid merely because you reached Stripe or returned to the site.
              </li>
            </Steps>
          </Topic>
        </section>
      )}

      {guide === 'organizer' && (
        <section id="organizer-guide" className="mt-14 scroll-mt-24 space-y-4">
          <div className="max-w-3xl">
            <p className="eyebrow">Organizer</p>
            <h2 className="text-2xl font-semibold tracking-tight">Build and run an event</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Start in Organizer Portal or Admin Portal → Events. Organizers can manage events they
              created or were assigned. Admins can manage club events across organizers.
            </p>
          </div>
          <Topic id="organizer-dashboard" title="Use the Organizer dashboard to triage events">
            <p>
              The dashboard shows events you created or that are assigned to you, with upcoming and
              past counts plus confirmed and waitlisted registration totals. In the event list,
              compare each session’s date, publication status, capacity, and registration counts.
              Select Manage to open that event’s management page; use Events for the complete list.
            </p>
            <p>
              The totals help you spot a full event, a growing waitlist, or a session that still
              needs setup. They do not replace checking an event’s individual participant, payment,
              court, and match records.
            </p>
            <p className="flex flex-wrap gap-4">
              <LinkButton href="/admin/organizer-dashboard">Organizer dashboard</LinkButton>
              <LinkButton href="/admin/events">Your event list</LinkButton>
            </p>
          </Topic>

          <Topic
            id="organizer-event-setup"
            title="Create or edit an event: what each field controls"
          >
            <p>
              On the event form, choose the event format before filling in format-specific options.
              Changing the format resets or hides settings that do not apply.
            </p>
            <FieldTable
              rows={[
                {
                  field: 'Event title / description',
                  value:
                    'Use a clear event title; add participant-facing details and practical instructions in the description.',
                  effect:
                    'The title identifies cards and pages; description text appears on the public page where enabled.',
                },
                {
                  field: 'Organizer',
                  value:
                    'Admins choose an organizer; the event creator is the default. Organizers do not assign another owner.',
                  effect:
                    'Organizer ownership determines which events appear in an organizer’s portal and which events they can manage.',
                },
                {
                  field: 'Event type',
                  value:
                    'Doubles tournament, League, Social event, Social Doubles Ladder, or Team tournament.',
                  effect:
                    'This controls registration inputs, eligibility, competition setup, public sections, and which management tools appear.',
                },
                {
                  field: 'Participant gender restriction',
                  value:
                    'For non-tournament formats that show this field, choose none, male only, or female only.',
                  effect:
                    'The registration procedure checks the member’s profile gender. Tournament category and League/Ladder gender use their own settings.',
                },
                {
                  field: 'Publication',
                  value: 'Draft, Published, or Cancelled.',
                  effect:
                    'Draft events are not publicly listed. Published events can accept registration only during their window. Cancelled events remain identifiable as cancelled.',
                },
                {
                  field: 'Cost per person (CAD)',
                  value: 'Enter a non-negative dollar amount, including cents.',
                  effect:
                    'The app uses this amount for payment records and checkout; describe any relevant terms in the event description.',
                },
                {
                  field: 'Maximum attendees / tournament capacity',
                  value:
                    'Set the entrant limit. Doubles tournaments may leave total capacity unlimited and instead use category limits.',
                  effect:
                    'The total cap and category cap are enforced at registration; tournament counts are participant entries, not just pairs.',
                },
                {
                  field: 'Location / courts available',
                  value: 'Enter the location shown to players and select 1–4 available courts.',
                  effect:
                    'Court count bounds assignments and informs scheduling; it does not by itself create a court schedule.',
                },
                {
                  field: 'Active paid membership required',
                  value:
                    'For non-tournament event types, check this when only active paid members may enter.',
                  effect:
                    'Unpaid, expired, or unapproved accounts cannot use a paid-member-only registration.',
                },
                {
                  field: 'Waitlist / organizer notes',
                  value:
                    'Enable waitlist if you want overflow registrations; notes are for event managers.',
                  effect:
                    'The waitlist is used only when enabled. Keep private operational notes out of public description fields.',
                },
                {
                  field: 'Event starts/ends and registration opens/cutoff',
                  value: 'Set local date and time for each boundary.',
                  effect:
                    'These times govern registration availability and when score entry becomes permissible. Check the cutoff against the event start.',
                },
                {
                  field: 'Recurring series',
                  value:
                    'For supported Social, Social Doubles Ladder, and League events: choose weekly, biweekly, or monthly; day; start date; repeat-until date; session start/end; and how many days before each session registration opens/closes, with times.',
                  effect:
                    'The app creates separate session events. You can edit shared fields across the series, but other sessions keep their dates, participants, and court assignments.',
                },
              ]}
            />
            <Callout>
              Tournament events cannot be recurring. A League is a tournament-backed competition
              whose event sessions share the League identity and settings.
            </Callout>
            <p>
              <LinkButton href="/admin/events/create">Open Create event</LinkButton>
            </p>
          </Topic>

          <Topic
            id="organizer-competitions"
            title="Configure tournaments, Leagues, and Social Doubles Ladders"
            intro="These fields determine who can enter, how the draw is formed, how results are ranked, and what participants see. Decide the competition rules before opening registration."
          >
            <h4 className="font-semibold">Doubles tournament and Team tournament</h4>
            <FieldTable
              rows={[
                {
                  field: 'Doubles categories',
                  value:
                    'Enable Mixed, Men’s, and/or Women’s doubles; enter a capacity for each enabled category or leave it blank for no category cap.',
                  effect:
                    'Only enabled categories appear to registrants. A category cap and total capacity both apply.',
                },
                {
                  field: 'Team registration capacity',
                  value: 'For Team tournament, set the team-category limit or leave it blank.',
                  effect: 'This limits team entries, rather than individual players.',
                },
                {
                  field: 'Registration options',
                  value:
                    'Enable Individual and/or With partner. If both are enabled, registrants choose their mode.',
                  effect:
                    'Individual entries wait for organizer pairing; pair entries register two players together. A one-mode setup hides the choice from users.',
                },
                {
                  field: 'Competition phases',
                  value:
                    'Select Round robin, optional Preliminary knockout (requires round robin), Final knockout; for team format choose Team round robin and/or Team knockout.',
                  effect:
                    'Only selected phases are generated and scored. Review dependencies before publishing the event.',
                },
                {
                  field: 'Scoring template per phase',
                  value:
                    'Choose One set, Best of three sets, or for team knockout “Two sets; if split, third set awards team points.”',
                  effect:
                    'Validation and generated tournament rules use this scoring format. Ensure it matches the rules you tell players.',
                },
                {
                  field: 'Group count / teams per group / teams promoted',
                  value:
                    'When round robin is enabled, choose how many groups, how many entries per group, and—if knockout follows—how many top entries advance from each group.',
                  effect:
                    'The group draw and knockout qualifiers depend on these counts. Use counts that fit actual registrations.',
                },
                {
                  field: 'Group ranking priority',
                  value:
                    'Move available criteria into the priority list and order them highest-first: matches won, sets won, games won, set difference, game difference, head-to-head; Team tournaments keep Points first.',
                  effect:
                    'This order resolves group ranking ties and determines who advances. Match the published competition rules.',
                },
                {
                  field: 'Match length / break',
                  value:
                    'Set approximate match duration (30–240 minutes) and inter-match break (10–60 minutes).',
                  effect:
                    'Automatic scheduling uses these estimates to place matches; they are planning inputs, not score rules.',
                },
                {
                  field: 'Tournament rules',
                  value: 'Enter or generate the rules text.',
                  effect:
                    'Rules are displayed to players. Check generated text against the phases, scoring, and advancement settings you selected.',
                },
                {
                  field: 'Allow non-member registration / publish details',
                  value:
                    'Enable guest entries if appropriate; separately choose whether participants, teams, schedule, and results are public.',
                  effect:
                    'Guest registration does not create a member account and uses card checkout. Public details make competition information visible without signing in.',
                },
              ]}
            />
            <h4 className="pt-2 font-semibold">League-specific inputs</h4>
            <FieldTable
              rows={[
                {
                  field: 'League gender',
                  value: 'Choose Men’s or Women’s.',
                  effect:
                    'This sets the League’s fixed category and gender restriction. The player’s profile gender controls eligibility; the event registration page does not ask for a redundant Category.',
                },
                {
                  field: 'Associate with existing league',
                  value:
                    'Select an existing League of the same gender, or leave “Create a new league.”',
                  effect:
                    'Associated events roll into the same League standings and share the League’s identity. An existing League’s name stays fixed; the event title remains independent.',
                },
                {
                  field: 'League name',
                  value:
                    'For a new League, enter a unique name; for an existing League, this name is loaded from that League.',
                  effect:
                    'This is the competition identity used to aggregate results across its events.',
                },
              ]}
            />
            <p>
              League setup uses the doubles registration mode and a single round-robin group. Set
              each event’s dates, registration window, venue, capacity, and price separately. An
              established League team registers both players together in a later event; a player
              without an assigned League team may enter as a single and be paired by an organizer.
            </p>
            <h4 className="pt-2 font-semibold">Social Doubles Ladder-specific inputs</h4>
            <FieldTable
              rows={[
                {
                  field: 'Ladder gender',
                  value: 'Choose Men’s or Women’s.',
                  effect:
                    'Sets the gender restriction and determines which existing ladders can be associated.',
                },
                {
                  field: 'Associate with existing ladder / Ladder name',
                  value:
                    'Choose an existing ladder of that gender, or create one with a unique name.',
                  effect:
                    'Sessions associated with the same ladder contribute to the same running ranking; the event title remains a session title.',
                },
                {
                  field: 'Position points (1st through 4th)',
                  value:
                    'Enter the points awarded at each of the four positions (defaults are 2, 1, -1, -2).',
                  effect:
                    'These values are awarded to players according to their position in that session; tied players receive the same point value for the tied position.',
                },
                {
                  field: 'Ranking criteria',
                  value:
                    'Select and order Sets won, Games won, Games difference, and Sets difference; at least one metric must be selected.',
                  effect:
                    'These metrics rank players within a session and resolve standings ties in the order you choose.',
                },
                {
                  field: 'Previous ladder carryover',
                  value:
                    'Choose Start from zero, Carry over initial positions only, or Carry over positions and points. If carrying over, choose the previous ladder.',
                  effect:
                    'This decides whether existing players start with a seeded position or retain prior points; selecting the wrong predecessor mixes competition seasons.',
                },
              ]}
            />
          </Topic>

          <Topic
            id="organizer-running"
            title="After publishing: participants, draws, courts, and scores"
            intro="Use the event’s management page. Inputs here change the actual pairing, schedule, and result records."
          >
            <Steps>
              <li>
                <strong>Check registrations.</strong> Confirm each participant’s category, gender
                eligibility, membership status, pair/team, and payment status. When adding a
                non-member to a regular doubles tournament, enter a correct full name, private
                contact email/phone, and gender profile; these details are used for contact and
                eligibility.
              </li>
              <li>
                <strong>Pair doubles entries.</strong> Select Player one and Player two from the
                same category, then Create pair. A player already paired in that category cannot be
                reused. For later League events, registering a member with a confirmed League team
                creates both event entries/pair together. New League players can be added singly and
                paired once eligible.
              </li>
              <li>
                <strong>Place groups and create draws.</strong> Assign tournament pairs/teams to
                groups or use Random group draw to distribute the current entries as evenly as
                possible. Review the group count and rank criteria first. Generate the knockout draw
                only after prerequisites are ready; group-place slots resolve as results become
                available.
              </li>
              <li>
                <strong>Schedule.</strong> Suggest schedule for a round-robin phase, then inspect
                each match’s date/time, court, and participant sides. Court changes can create
                conflicts; the interface marks them so you can decide whether to keep or resolve the
                move.
              </li>
              <li>
                <strong>Enter scores only after start.</strong> Choose the correct side and enter
                set scores in the format shown beside the score field (for example,{' '}
                <code>6-4, 6-3</code>). The phase’s scoring template validates the score and
                calculates a winner; it updates standings and the next knockout match. Team
                tournament scores require two players assigned to each team side.
              </li>
              <li>
                <strong>Correct ranking overrides with a reason.</strong> Reorder a group’s
                standings or promotion flags only when resolving a real exception. Enter the
                required reason; the change is retained in the event audit history.
              </li>
              <li>
                <strong>For ladder sessions, assign courts.</strong> In court management, place each
                confirmed player once per subsession. Automatic ladder assignment uses the current
                ranking and supports up to four courts; manually assign beyond that. Enter session
                match scores so the configured metrics and position points calculate the ranking.
              </li>
            </Steps>
            <div className="flex flex-wrap gap-4">
              <LinkButton href="/admin/events">Manage events</LinkButton>
              <LinkButton href="/admin/organizer-dashboard">Organizer Portal</LinkButton>
            </div>
          </Topic>
        </section>
      )}

      {guide === 'admin' && (
        <section id="admin-guide" className="mt-14 scroll-mt-24 space-y-4">
          <div className="max-w-3xl">
            <p className="eyebrow">Administrator</p>
            <h2 className="text-2xl font-semibold tracking-tight">Club-wide operations</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The Admin Portal contains member approvals, event ownership, payment review, and club
              publishing tools. Payments and some document tools require an approved admin profile.
            </p>
          </div>
          <Topic id="admin-dashboard" title="Read the Admin dashboard overview">
            <p>
              The Admin dashboard is a club-wide monitoring view. Its member card summarizes the
              profile count plus paid, overdue, and pending membership counts. Its event card
              summarizes published events in the configured season. Attendance statistics group
              sessions with the same event title and compare registrations at cutoff with capacity,
              vacant places, waitlisted entrants, and promotions.
            </p>
            <p>
              The overdue-membership table identifies approved members whose latest membership has
              an active or expired status and no recorded payment. Treat these as review queues:
              open Membership or Payments to inspect the underlying record before contacting a
              member or changing their status. The dashboard summarizes current data; membership,
              event, and payment pages are where you make changes.
            </p>
            <p>
              <LinkButton href="/admin/dashboard">Open Admin dashboard</LinkButton>
            </p>
          </Topic>
          <Topic id="admin-event-setup" title="Admin event setup and organizer assignment">
            <p>
              Use the same field-by-field event form described in{' '}
              <Link className="font-medium text-primary underline" href="/help/organizer">
                Organizer event guide
              </Link>
              . In addition, the Organizer selector determines who owns the event operationally:
              assign the organizer before publishing if they will manage entrants, courts, and
              results.
            </p>
            <p>
              When applying shared changes to a recurring series, the form updates title,
              description, gender restriction, publication, capacity, price, location, membership
              requirement, waitlist, and available courts. It does <strong>not</strong> change other
              sessions’ dates, participants, or court assignments.
            </p>
            <p>
              <LinkButton href="/admin/events">Open event management</LinkButton>
            </p>
          </Topic>
          <Topic
            id="admin-competition-setup"
            title="Admin tournament, League, and ladder configuration"
          >
            <p>
              The Organizer guide contains the detailed event-form and competition input reference:{' '}
              <Link className="font-medium text-primary underline" href="/help/organizer">
                open Organizer guide
              </Link>
              . Admin responsibilities are to ensure categories and eligibility match club policy,
              associate each League event with the correct standings record, and verify that scoring
              and ranking settings agree with the published rules. Admins can manage events across
              organizers.
            </p>
            <Steps>
              <li>
                Confirm event type and category restrictions before opening entries. A gender or
                category change can make existing registrants ineligible, and a public category no
                longer matching the selected categories should be addressed before publishing.
              </li>
              <li>
                Set capacity and each enabled category capacity deliberately. The app enforces both
                limits at registration.
              </li>
              <li>
                For League events, connect every event to the intended League record. A new name
                creates a new standings identity; a wrong association splits or combines results
                incorrectly.
              </li>
              <li>
                Review the scoring template and ranking criteria against the rules text. Scores
                drive match winners, advancement, event standings, and League cumulative standings.
              </li>
              <li>
                Keep guest registration disabled unless the event is intentionally open without
                accounts. Guests use card checkout; they cannot submit Interac through the guest
                flow.
              </li>
            </Steps>
          </Topic>
          <Topic id="admin-ranking-controls" title="How results become rankings and standings">
            <p>
              The Rankings page is calculated from recorded results; it is not a spreadsheet where
              an admin directly edits each player’s overall rank. Correct the source record when a
              score or participant is wrong, then review the competition view after it recalculates.
            </p>
            <Steps>
              <li>
                For player rankings and Member Results, check that the event score or tournament set
                result has the right players, side, score, and played date. Future-dated scores do
                not count yet. These records supply wins, losses, games, and sets.
              </li>
              <li>
                For a tournament, the event’s scoring template validates results and drives match
                winners, group tables, and knockout advancement. If correcting a group placement or
                promotion exception, use the event standings override and give the required reason;
                the override is retained in audit history.
              </li>
              <li>
                For a League, confirm each event points to the intended League record. Its current
                table aggregates team results across associated League events; a wrong association
                can split or combine standings.
              </li>
              <li>
                For a Social Doubles Ladder, check the session scores and the Ladder’s position
                points, ranking metrics, and carryover settings. Session results and configured
                tie-breaks determine points and the order in the Ladder table.
              </li>
            </Steps>
            <p>
              The default player ranking sorts by games-won percentage, then total games won,
              recorded result count, and player name. Changing a table’s display sort does not
              change the calculated rank. Use the player Results page and the relevant competition
              selector to verify the period or standings you are investigating.
            </p>
            <p>
              <LinkButton href="/rankings">Review Club rankings</LinkButton>
            </p>
          </Topic>
          <Topic
            id="admin-payments"
            title="Payment flows: Stripe, Interac, and refunds"
            intro="Stripe and Interac have different confirmation paths. A pending payment is not a paid membership or confirmed paid entry until the payment record is fulfilled."
          >
            <h4 className="font-semibold">What a player sees with Stripe</h4>
            <Steps>
              <li>
                The member chooses Pay (or a tournament participant chooses Pay for myself / Pay for
                both partners). The server checks ownership, amount, membership/registration state,
                and creates a pending payment record before opening Stripe Checkout.
              </li>
              <li>
                The payer completes card checkout on Stripe. The app returns to the payment status
                page, which checks the Checkout Session and PaymentIntent, then finalizes the
                membership or registration after Stripe confirms success. A canceled or failed
                checkout does not fulfill it.
              </li>
              <li>
                Tell the payer to check Member → Payments or the event page if the status is
                processing. Avoid creating a second payment while the existing checkout is open; the
                app prevents duplicate active attempts for the same record.
              </li>
            </Steps>
            <h4 className="font-semibold">What a player does with Interac</h4>
            <Steps>
              <li>
                Interac appears only when enabled by an administrator and for a signed-in, approved
                payer. The app creates a pending payment request and shows the amount, recipient
                email, unique payment reference, and administrator-provided transfer instructions.
              </li>
              <li>
                The payer sends the transfer using those instructions and includes the reference
                exactly as shown. The app does not receive a bank confirmation automatically;
                membership or registration remains unpaid/pending.
              </li>
              <li>
                The administrator matches the received funds to the payment row and confirms it.
                Only then does the app mark the payment successful and fulfill the linked membership
                or event entry. If the transfer is not found or the amount/reference is wrong, leave
                it pending and follow up before confirming.
              </li>
            </Steps>
            <h4 className="font-semibold">Configure Interac and review the queue</h4>
            <FieldTable
              rows={[
                {
                  field: 'Enable Interac payments',
                  value: 'Turn on only after recipient and instructions are ready.',
                  effect: 'Adds the Interac option to eligible member payment screens.',
                },
                {
                  field: 'Recipient email',
                  value: 'The club account receiving transfers.',
                  effect: 'This is shown to the payer and included in the instructions email.',
                },
                {
                  field: 'Instructions',
                  value:
                    'Include auto-deposit status, required transfer message, and any payment-specific directions.',
                  effect: 'Displayed to the payer and sent by email with the payment reference.',
                },
                {
                  field: 'Review note',
                  value:
                    'Internal note is optional for confirming; required for rejecting an Interac payment.',
                  effect: 'Rejection requires a reason; confirmation fulfills the linked purchase.',
                },
              ]}
            />
            <Steps>
              <li>
                In Admin → Payments → Interac, save and verify the recipient email and instructions
                before enabling the option.
              </li>
              <li>
                Filter the Interac table and match the submitted amount, payer, purpose, and
                reference against the incoming transfer.
              </li>
              <li>
                Choose Confirm only after receipt is verified. Choose Reject when the request is
                invalid or not received; enter the required internal note so the member record has a
                reason.
              </li>
              <li>
                For Stripe refunds, refund only a succeeded or partially refunded payment with
                refundable balance. Enter the refund amount/reason in the refund form; the recorded
                refund updates the status and remaining refundable amount. Confirmed Interac
                payments have a separate manual-refund action because no card processor can reverse
                the transfer.
              </li>
            </Steps>
            <p>
              Payments → Report can filter by year, payment category, and method, then export
              matching rows as CSV. Stripe fees and net proceeds are shown where recorded;
              historical figures may be estimated when processor fee data is unavailable.
            </p>
            <p>
              <LinkButton href="/admin/payments">Open Payments</LinkButton>
            </p>
          </Topic>
          <Topic id="admin-members" title="Applications, member records, and membership plans">
            <Steps>
              <li>
                Review new applications in Admin → Membership → Applications. Check applicant
                details, then approve or reject using the application action; approval changes
                access to member pages.
              </li>
              <li>
                In Members, use search and the member record to correct contact details,
                role/status, skill rating, or gender where permitted. Role changes affect portal
                access; gender affects eligibility for gender-specific events and mixed doubles. The
                skill rating appears alongside tournament player/pair information where that
                information is shown.
              </li>
              <li>
                Membership Types controls the displayed single/family price, family adult/child
                limits, and season dates. Recheck the amount and term before saving because new
                checkout requests use those settings.
              </li>
              <li>
                For a family payment, every confirmed family member must have an approved profile
                and accept the current waiver. If the waiver version changes, the family must accept
                the current version before checkout can be fulfilled.
              </li>
              <li>
                Use invitation controls to create/send an invitation with the intended role. Verify
                the recipient address and role before sharing the link.
              </li>
            </Steps>
            <p>
              <LinkButton href="/admin/members">Open member administration</LinkButton>
            </p>
          </Topic>
          <Topic id="admin-publishing" title="Club profile, website, gallery, and documents">
            <FieldTable
              rows={[
                {
                  field: 'Club Profile',
                  value:
                    'Maintain club name, short name, public description, contacts, map/location URL, social links, logo, and club contacts.',
                  effect:
                    'These details appear in the public header/footer, Contacts page, and location displays.',
                },
                {
                  field: 'Publications → News',
                  value: 'Create a draft title/body, then choose Publish when the copy is ready.',
                  effect:
                    'Published news appears on the public home page; publishing news is separate from sending an email.',
                },
                {
                  field: 'Publications → Announcements',
                  value:
                    'Write the email and select a recipient group; review the confirmation count before sending.',
                  effect:
                    'This sends a separate email. “All approved members” ignores newsletter preferences; “Newsletter subscribers” respects the newsletter audience.',
                },
                {
                  field: 'Publications → Gallery',
                  value: 'Create/edit albums, captions, and public visibility.',
                  effect: 'Only published/public albums appear in the public Gallery.',
                },
                {
                  field: 'Documents / legal',
                  value:
                    'Select the document type/version or uploaded-document access category before saving.',
                  effect:
                    'Membership waiver versions are used in membership checkout; uploaded documents are restricted to the configured audience.',
                },
              ]}
            />
            <p>
              After saving, open the public page or a member account to confirm the correct audience
              sees the content. Use Audit Logs to trace administrative changes when investigating an
              event or payment issue.
            </p>
            <p className="flex flex-wrap gap-4">
              <LinkButton href="/admin/club-profile">Club Profile</LinkButton>
              <LinkButton href="/admin/website">Publications</LinkButton>
              <LinkButton href="/admin/documents">Documents</LinkButton>
              <LinkButton href="/admin/audit-logs">Audit Logs</LinkButton>
            </p>
          </Topic>
        </section>
      )}

      {guide === 'member' && (
        <section id="member-guide" className="mt-14 scroll-mt-24 space-y-4">
          <div className="max-w-3xl">
            <p className="eyebrow">Approved members</p>
            <h2 className="text-2xl font-semibold tracking-tight">
              Your account, entries, and payments
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use Member Portal for profile, Membership, Payments, Results, and eligible member
              tools.
            </p>
          </div>
          <Topic id="member-profile" title="Set profile information that affects event entry">
            <FieldTable
              rows={[
                {
                  field: 'Tennis skill rating',
                  value:
                    'Choose the rating that reflects your current play. The profile requires a rating.',
                  effect:
                    'Your selected rating is shown next to your name in participant lists for events you are registered in when that roster is available, and in tournament participant/pair displays.',
                },
                {
                  field: 'Gender',
                  value: 'Male or female (optional)',
                  effect:
                    'This is used to check Men’s/Women’s eligibility and mixed doubles pairing. Mixed-pair validation requires opposite genders when both are stated.',
                },
                {
                  field: 'Name, email and phone',
                  value: 'Keep the name players recognize and a working contact number and email.',
                  effect:
                    'Your contacts are visible to registered members and will only be used for club and event communications.',
                },
                {
                  field: 'Email preferences',
                  value:
                    'Choose which event registration, waitlist, cancellation, reminder, new-event, and newsletter emails you want.',
                  effect:
                    'These control automated emails sent by this website. Admins may choose to override preferences for important announcements.',
                },
                {
                  field: 'Birthday visibility, playing hand, avatar, chat notifications',
                  value: 'Set only the details you want used/displayed.',
                  effect:
                    'Birthday display and chat notification preferences control those respective optional features.',
                },
              ]}
            />
            <p>
              <LinkButton href="/member/profile">Edit my profile</LinkButton>
            </p>
          </Topic>
          <Topic id="member-events" title="Register for ordinary club events">
            <Steps>
              <li>
                Open the event and confirm it is published, registration is open, and you meet any
                gender restriction or active paid membership requirement.
              </li>
              <li>
                Press Register. The event procedure records a confirmed place or waitlist status.
                For a paid event, follow the payment action shown on the event page.
              </li>
              <li>
                If a waitlist is enabled and the event is full, your place remains waitlisted until
                promoted; waitlisted entries are not charged by ordinary event checkout.
              </li>
              <li>
                To leave, choose Withdraw and read the event-specific confirmation. The app may
                promote a waitlisted member after a confirmed place is released.
              </li>
            </Steps>
            <p>
              <LinkButton href="/events">Find an event</LinkButton>
            </p>
          </Topic>
          <Topic
            id="member-competitions"
            title="Enter a tournament, Ladder session, or League event"
          >
            <h4 className="font-semibold">Doubles tournaments</h4>
            <Steps>
              <li>
                Choose an enabled category (Mixed, Men’s, or Women’s) if the tournament offers more
                than one. The selected category determines the eligibility check and the entry’s
                category capacity.
              </li>
              <li>
                If the organizer allows both modes, select register individually or with a partner.
                Individual means the organizer can pair you later; pair means select another active
                member or, if guests are allowed, add a non-member partner.
              </li>
              <li>
                Your profile gender is used for a signed-in entry. A new partner needs name/email;
                phone, gender, and skill are optional as displayed. Category checks apply to both
                players; when both genders are known in Mixed, they must be one male and one female.
              </li>
              <li>
                Submit once. If payment is due, choose Pay for myself or Pay for both partners. Both
                partner entries can be paid in a single Stripe checkout; do not assume your partner
                is paid unless the page reports team payment complete.
              </li>
            </Steps>
            <h4 className="font-semibold">Social Doubles Ladder</h4>
            <p>
              Register for each published Ladder session like an event. The Ladder gender setting
              makes the session Men’s or Women’s and checks profile gender for eligibility. Players
              are assigned to courts/subsessions; results rank players by the Ladder’s selected
              metrics and award the configured position points.
            </p>
            <h4 className="font-semibold">League</h4>
            <p>
              A League uses fixed teams throughout the season. A player with a confirmed League team
              sees <strong>Register my team</strong>; either partner can press it, and both
              teammates are entered together. If you are a new League player with no team yet,
              either register your team for the next available event, or use the single-player
              registration offered on the event page; an organizer can assign your partner later.
              Withdrawing from an established team entry withdraws both partners after confirmation.
            </p>
            <p>
              Payment status is shown per entry and for the team. Pay for both players only when
              both are unpaid; a prior paid partner is not charged twice.
            </p>
          </Topic>
          <Topic id="member-payments" title="Membership, Stripe, and Interac payments">
            <h4 className="font-semibold">Individual membership</h4>
            <Steps>
              <li>
                Open Membership and read the current waiver. Select its acceptance before starting
                payment; checkout records which waiver version you accepted.
              </li>
              <li>
                Review the season dates and single-membership price shown. Choose Stripe card
                checkout or Interac if that option is enabled.
              </li>
              <li>
                For Stripe, complete the hosted checkout. The return page checks Stripe’s
                confirmation and only then activates/marks the membership paid. If the page says
                processing, wait and check Payment History before trying again.
              </li>
              <li>
                For Interac, send the exact amount to the shown recipient using the unique reference
                and administrator instructions. This is a manual transfer; your membership remains
                pending until an administrator confirms receipt.
              </li>
            </Steps>
            <h4 className="font-semibold">Family membership</h4>
            <Steps>
              <li>
                Invite each intended family member from Membership. They must accept the invitation
                and have an approved account before they are a confirmed family member.
              </li>
              <li>
                Every confirmed family member must accept the current waiver. Check the family
                member list for the waiver-accepted status before checkout.
              </li>
              <li>
                The payer chooses family Stripe checkout or, when enabled, family Interac. The
                family is not marked paid until Stripe confirms or an administrator confirms the
                transfer.
              </li>
            </Steps>
            <h4 className="font-semibold">Read a payment record</h4>
            <p>
              Member → Payments lists purpose, amount, method, status, date, and refund information.
              “Pending” means no final payment confirmation; “Succeeded” is the processor
              confirmation; “Refunded” and “Partially refunded” reflect a recorded refund. For
              Interac, the reference shown in the instructions identifies the transfer to the club.
            </p>
            <p>
              <LinkButton href="/member/membership">Membership and family plan</LinkButton>
              <span className="mx-2 text-muted-foreground">·</span>
              <LinkButton href="/member/payments">Payment history</LinkButton>
            </p>
          </Topic>
          <Topic id="member-results" title="Read your Results page">
            <p>
              Results summarizes your recorded match performance for a selected membership season or
              all time. The top cards show your overall rank and, when your profile has a gender
              set, your rank among players of that gender. The Sets and Games cards show won/lost
              totals and win percentages for the chosen period.
            </p>
            <p>
              The score list is newest first and shows the event, date, partner, opponents, score,
              and whether the recorded result is a win, loss, or draw. It includes recorded event
              scores and tournament set results; future-dated scores are excluded. If no eligible
              results are available for the period, the page reports that instead of inventing a
              rank.
            </p>
            <p>
              Use the season selector to compare a season with All time. The season boundary comes
              from the club’s membership-season settings. Results and rankings require an approved
              account with a paid membership on record; approved administrators do not need a paid
              membership for access.
            </p>
            <p>
              <LinkButton href="/member/results">Open my Results</LinkButton>
            </p>
          </Topic>
          <Topic id="member-rankings" title="Explore Club rankings and competition standings">
            <p>
              Club rankings is the broader comparison view. Choose a full season or all time, a
              Social Doubles Ladder, a League, or a tournament from the Competition selector. The
              selected view changes the table because each competition has its own ranking rules.
            </p>
            <FieldTable
              rows={[
                {
                  field: 'Season or All time',
                  value: 'Use the configured membership season or include every recorded result.',
                  effect:
                    'Players with scores rank by games-won percentage; ties use total games won, number of recorded results, then player name. Players with no scores are listed separately without a rank.',
                },
                {
                  field: 'Social Doubles Ladder',
                  value: 'Select the named men’s or women’s Ladder.',
                  effect:
                    'The points column uses the configured points for session positions. The Ladder’s selected metrics break ties; the season may carry forward seeded positions or previous points.',
                },
                {
                  field: 'League',
                  value: 'Select the League name.',
                  effect:
                    'The table shows cumulative team standings across completed events associated with that League: rank, team, played, wins, points, sets, and games.',
                },
                {
                  field: 'Doubles tournament',
                  value: 'Select a tournament that has recorded results.',
                  effect:
                    'The result view shows available group standings and knockout brackets for that event.',
                },
                {
                  field: 'Gender filter and sortable columns',
                  value:
                    'In the player-ranking table, choose All players, Male, or Female; sort by a column heading.',
                  effect:
                    'The filter changes the displayed comparison group. The “You” marker highlights your row; sorting changes display order, not the calculated rank.',
                },
              ]}
            />
            <p>
              The club rankings page is available to approved members with a paid membership on
              record and to administrators. A competition without scored results may not appear as
              an option yet.
            </p>
            <p>
              <LinkButton href="/rankings">Open Club rankings</LinkButton>
            </p>
          </Topic>
          <Topic id="member-resources" title="Use the Gallery and Documents sections">
            <p>
              Gallery contains published photo albums. Public albums are available to everyone;
              members-only albums appear to approved members with a paid membership on record and to
              administrators. Select a photo to open the larger viewer and move through the album.
            </p>
            <p>
              Documents contains club bylaws, minutes, and other uploaded member resources. It
              requires an approved paid member account or administrator access. Search by document
              name, choose newest-first or alphabetical sorting, then use Download PDF. If a file is
              unavailable, try again later or contact the club with the document title.
            </p>
            <p className="flex flex-wrap gap-4">
              <LinkButton href="/gallery">Open Gallery</LinkButton>
              <LinkButton href="/documents">Open Documents</LinkButton>
            </p>
          </Topic>
          <Topic id="member-chat" title="Member chat: image, mention, and message controls">
            <p>
              The member chat is a shared space for approved members. Use it for club coordination
              and include enough event context that other members can understand what you mean.
            </p>
            <FieldTable
              rows={[
                {
                  field: 'Message text',
                  value: 'Type a message; Enter sends it and Ctrl+Enter inserts a new line.',
                  effect:
                    'Messages are visible to approved members. Mention suggestions can notify a named member according to that member’s notification settings.',
                },
                {
                  field: 'Image attachment',
                  value: 'Attach a JPEG, PNG, GIF, or WebP image no larger than 1 MB.',
                  effect:
                    'The image is uploaded with the message and displayed in chat. Unsupported formats or oversized files are rejected.',
                },
                {
                  field: 'Edit or delete',
                  value: 'Use the message menu on your own recent message.',
                  effect:
                    'Your message can be edited or deleted only within five minutes of posting.',
                },
                {
                  field: 'Chat notification preference',
                  value: 'Change the chat notification setting in your member profile.',
                  effect:
                    'This controls chat email notifications; it does not remove your access to the chat.',
                },
              ]}
            />
          </Topic>
        </section>
      )}

      <aside className="mt-12 flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-5">
        <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">Need help with a specific entry?</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Include the event name, the player/partner involved, the payment reference if
            applicable, and what status the page shows. Do not send card details.
          </p>
          <p className="mt-2">
            <LinkButton href="/contacts">Club contact information</LinkButton>
          </p>
        </div>
      </aside>
    </div>
  );
}
