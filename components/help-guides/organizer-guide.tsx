import { Callout, FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function OrganizerHelpGuide() {
  return (
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
          The dashboard shows events you created or that are assigned to you, with upcoming and past
          counts plus confirmed and waitlisted registration totals. In the event list, compare each
          session’s date, publication status, capacity, and registration counts. Select Manage to
          open that event’s management page; use Events for the complete list.
        </p>
        <p>
          The totals help you spot a full event, a growing waitlist, or a session that still needs
          setup. They do not replace checking an event’s individual participant, payment, court, and
          match records.
        </p>
        <p className="flex flex-wrap gap-4">
          <LinkButton href="/admin/organizer-dashboard">Organizer dashboard</LinkButton>
          <LinkButton href="/admin/events">Your event list</LinkButton>
        </p>
      </Topic>

      <Topic id="organizer-event-setup" title="Create or edit an event: what each field controls">
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
                'Set the total entrant limit. Team tournaments use this total limit; doubles tournaments may also set limits for individual categories.',
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
          Tournament events cannot be recurring. A League is a tournament-backed competition whose
          event sessions share the League identity and settings.
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
                'Only enabled doubles categories appear to registrants. Doubles category caps work alongside total capacity; Team tournaments use total capacity only.',
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
          League setup uses the doubles registration mode and a single round-robin group. Set each
          event’s dates, registration window, venue, capacity, and price separately. An established
          League team registers both players together in a later event; a player without an assigned
          League team may enter as a single and be paired by an organizer.
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
              value: 'Choose an existing ladder of that gender, or create one with a unique name.',
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
            eligibility, membership status, pair/team, and payment status. When adding a non-member
            to a regular doubles tournament, enter a correct full name, private contact email/phone,
            and gender profile; these details are used for contact and eligibility.
          </li>
          <li>
            <strong>Pair doubles entries.</strong> Select Player one and Player two from the same
            category, then Create pair. A player already paired in that category cannot be reused.
            For later League events, registering a member with a confirmed League team creates both
            event entries/pair together. New League players can be added singly and paired once
            eligible.
          </li>
          <li>
            <strong>Place groups and create draws.</strong> Assign tournament pairs/teams to groups
            or use Random group draw to distribute the current entries as evenly as possible. Review
            the group count and rank criteria first. Generate the knockout draw only after
            prerequisites are ready; group-place slots resolve as results become available.
          </li>
          <li>
            <strong>Schedule.</strong> Suggest schedule for a round-robin phase, then inspect each
            match’s date/time, court, and participant sides. Court changes can create conflicts; the
            interface marks them so you can decide whether to keep or resolve the move.
          </li>
          <li>
            <strong>Enter scores only after start.</strong> Choose the correct side and enter set
            scores in the format shown beside the score field (for example, <code>6-4, 6-3</code>).
            The phase’s scoring template validates the score and calculates a winner; it updates
            standings and the next knockout match. Team tournament scores require two players
            assigned to each team side.
          </li>
          <li>
            <strong>Correct ranking overrides with a reason.</strong> Reorder a group’s standings or
            promotion flags only when resolving a real exception. Enter the required reason; the
            change is retained in the event audit history.
          </li>
          <li>
            <strong>For ladder sessions, assign courts.</strong> In court management, place each
            confirmed player once per subsession. Automatic ladder assignment uses the current
            ranking and supports up to four courts; manually assign beyond that. Enter session match
            scores so the configured metrics and position points calculate the ranking.
          </li>
        </Steps>
        <div className="flex flex-wrap gap-4">
          <LinkButton href="/admin/events">Manage events</LinkButton>
          <LinkButton href="/admin/organizer-dashboard">Organizer Portal</LinkButton>
        </div>
      </Topic>
    </section>
  );
}
