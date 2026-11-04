import { Callout, FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

const sharedEventFields = [
  {
    field: 'Event title',
    value: 'Use the public name participants can recognize.',
    effect: 'Appears on cards, event pages, emails, and event management lists.',
  },
  {
    field: 'Organizer',
    value: 'Select the person who will manage the event.',
    effect: 'Assigns an organizer; admins can still manage events across organizers.',
  },
  {
    field: 'Event type',
    value: 'Choose the matching event template before completing conditional settings.',
    effect: 'Determines which configuration fields and registration/competition workflows apply.',
  },
  {
    field: 'Publication',
    value: 'Draft, Published, or Cancelled.',
    effect:
      'Draft events are not open for registration; cancelled events show their cancelled state and disable registration.',
  },
  {
    field: 'Description',
    value: 'Enter participant-facing details where the selected event type provides the field.',
    effect:
      'Provides event information on the event page; tournament public-detail settings separately control competition details.',
  },
  {
    field: 'Price',
    value: 'Enter Canadian dollars; zero means free.',
    effect:
      'Determines what the payment flow charges, subject to the selected registration option and event type.',
  },
  {
    field: 'Capacity',
    value:
      'Set maximum attendees; tournament capacity is determined slightly differently, see below for details.',
    effect:
      'Registration is limited by total capacity and, where configured, category capacity (see details below).',
  },
  {
    field: 'Location',
    value: 'Enter the venue participants should attend.',
    effect: 'Appears in event details and supports location-related displays.',
  },
  {
    field: 'Courts available',
    value: 'Set the number of courts for event types that schedule courts.',
    effect: 'Bounds court assignments for the event.',
  },
  {
    field: 'Active paid membership required',
    value:
      'Enable for eligible non-tournament events only when registration requires a current paid membership.',
    effect: 'Blocks event registration for accounts without eligible paid membership.',
  },
  {
    field: 'Waitlist',
    value: 'Enable when full-capacity entrants should be queued.',
    effect: 'Allows a waitlisted state and later promotion.',
  },
  {
    field: 'Organizer notes',
    value: 'Keep operational instructions here, not in public description.',
    effect: 'Notes are for event management and are not the participant-facing description.',
  },
];

const singleEventScheduleFields = [
  {
    field: 'Event/tournament starts and ends',
    value: 'Set local start and finish times; finish must follow start.',
    effect: 'Defines the displayed schedule and event duration.',
  },
  {
    field: 'Registration opens',
    value: 'Choose when the Register action becomes available.',
    effect: 'Registration is unavailable before this time.',
  },
  {
    field: 'Registration cutoff',
    value: 'Choose a cutoff after opening and no later than the event start.',
    effect: 'Closes new registrations and affects waitlist/competition preparation.',
  },
];

const seriesScheduleFields = [
  {
    field: 'Repeat and day',
    value: 'Choose weekly, every two weeks, or monthly and the weekday.',
    effect: 'Creates separate event sessions on the selected cadence.',
  },
  {
    field: 'Series dates and times',
    value: 'Set first date, repeat-until date, and session start/end time.',
    effect: 'Controls which sessions are created and their time of day.',
  },
  {
    field: 'Registration open/cutoff offsets',
    value:
      'Choose how many days before each session to open and close registration, plus the corresponding times.',
    effect: 'Calculates a separate registration window for each session.',
  },
];

export function AdminEventsGuide() {
  return (
    <div className="space-y-5">
      <Topic id="admin-event-types" title="Choose the right event type">
        <p>
          Event type determines the registration choices, eligibility rules, management tools, and
          how results are recorded. Choose it before filling in the form because each type exposes
          its own settings.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Social event',
              value: 'Use for regular club activities and social play.',
              effect:
                'Uses the standard participant list and can be configured with gender eligibility, cost, capacity, courts, paid-membership requirement, and waitlist.',
            },
            {
              field: 'Party',
              value: 'Use for a club party or gathering with one registration per approved member.',
              effect:
                'Always a single event. Approved members can register regardless of membership payment; an optional unnamed +1 can use one additional capacity place and have a separate guest cost.',
            },
            {
              field: 'Doubles tournament',
              value: 'Use for a tennis competition where players enter individually or as pairs.',
              effect:
                'Configure gender categories, draw phases, scoring, group sizes, and rules. Public guest registration can be enabled; participant and competition details have a separate public visibility setting.',
            },
            {
              field: 'League event',
              value: 'Use for a scheduled event that contributes to a shared League.',
              effect:
                'League events share identity and standings. Players can register singly before a fixed team exists; after a pair is established, later event registration registers the team together.',
            },
            {
              field: 'Team tournament',
              value: 'Use when registered players are assigned to teams and teams play matches.',
              effect:
                'Configure match categories, team scoring, groups, captains, and lineups. Teams and match lineups follow the tournament visibility settings.',
            },
            {
              field: 'Social Doubles Ladder',
              value:
                'Use for recurring doubles sessions that contribute to a shared Ladder ranking.',
              effect:
                'Configure gender, position points, ranking criteria, and optional carryover; each session has its own entries and results while updating the Ladder.',
            },
          ]}
        />
      </Topic>
      <Topic id="admin-event-create" title="Create an event: shared fields and timing">
        <p>
          Use the event type that matches how participants register and how the club will manage
          results. Complete the shared fields first, then read the specific type below before
          publishing. Assign an organizer who is expected to handle event operations.
        </p>
        <FieldTable rows={sharedEventFields} />
        <h4 className="text-base font-semibold">Single event schedule</h4>
        <FieldTable rows={singleEventScheduleFields} />
        <h4 className="text-base font-semibold">Series of events schedule</h4>
        <FieldTable rows={seriesScheduleFields} />
        <p>
          <LinkButton href="/admin/events/create">Open Create event</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-event-social" title="Configure a Social event">
        <FieldTable
          rows={[
            {
              field: 'Participant gender restriction',
              value: 'Choose no restriction, male participants only, or female participants only.',
              effect: 'Limits eligible registrants by the gender on their profile.',
            },
            {
              field: 'Cost per person',
              value: 'Set the amount each registration pays.',
              effect: 'Used for the participant’s event payment.',
            },
            {
              field: 'Maximum attendees',
              value: 'Set the total registration capacity.',
              effect: 'When full, new entries are blocked or waitlisted if waitlist is enabled.',
            },
            {
              field: 'Courts available',
              value: 'Choose how many courts the event manager can assign.',
              effect: 'Sets the court assignment range for this event.',
            },
            {
              field: 'Active paid membership required',
              value: 'Check only if unpaid members must not register.',
              effect: 'Enforces the paid-membership eligibility rule at registration.',
            },
            {
              field: 'Enable waitlist when full',
              value: 'Check to queue additional eligible registrants.',
              effect: 'Adds waitlist and promotion behavior when capacity has been reached.',
            },
          ]}
        />
        <p>
          Published Social events follow the site’s usual public card and event-page visibility.
          Visitors can see public event information and registration availability; registration
          eligibility still follows the membership, gender, and capacity settings above.
        </p>
      </Topic>
      <Topic id="admin-event-party" title="Configure a Party">
        <FieldTable
          rows={[
            {
              field: 'Cost per member',
              value: 'Set what the approved member pays for their own place.',
              effect: 'A member registering alone pays this amount.',
            },
            {
              field: 'Allow guests',
              value: 'Enable when an approved member may register with one unnamed +1.',
              effect:
                'Adds a “register with +1” option; the guest is included in the same registration.',
            },
            {
              field: 'Cost per guest',
              value: 'When guests are allowed, set the additional amount for the +1.',
              effect:
                'Adds to the member’s checkout amount. For example, a free member place and a $10 guest price produces a $10 total for a +1 registration.',
            },
            {
              field: 'Maximum attendees',
              value: 'Set the total person capacity, not the number of registration records.',
              effect: 'The member consumes one place and a +1 consumes a second place.',
            },
            {
              field: 'Publication, schedule, location, notes',
              value:
                'Set draft/published/cancelled status, the single event time, location, and manager notes.',
              effect:
                'Controls whether the event is published and the practical details shown to approved members.',
            },
          ]}
        />
        <p>
          Party events are only visible to approved members. An approved member may register whether
          or not their membership payment is current. Party is always one event and has no gender
          restriction, court count, paid-membership checkbox, or waitlist.
        </p>
      </Topic>
      <Topic id="admin-event-doubles" title="Configure a Doubles tournament">
        <FieldTable
          rows={[
            {
              field: 'Enabled categories and category capacity',
              value:
                'Enable Mixed, Men’s, and/or Women’s doubles; set an optional capacity for each enabled category.',
              effect:
                'Only enabled categories can be entered. Each category limit works together with total tournament capacity.',
            },
            {
              field: 'Registration options',
              value: 'Enable Individual, With partner, or both.',
              effect:
                'Individual entries can be paired by the organizer; partner entry registers a pair. If both are enabled, the player chooses.',
            },
            {
              field: 'Competition phases',
              value:
                'Choose preliminary knockout (requires round robin), round robin, and/or final knockout.',
              effect: 'Controls which draw phases are created and when advancement is possible.',
            },
            {
              field: 'Scoring template per phase',
              value: 'Choose One set or Best of three sets for each enabled phase.',
              effect:
                'Validates entered scores and determines match winners, standings, and knockout advancement.',
            },
            {
              field: 'Group count and teams per group',
              value: 'Set the number of groups and entries per group when round robin is enabled.',
              effect: 'Defines group allocation and round-robin match generation.',
            },
            {
              field: 'Teams promoted from each group',
              value: 'Set how many top entries advance when knockout follows round robin.',
              effect: 'Controls qualification from group standings.',
            },
            {
              field: 'Group ranking priority',
              value:
                'Order matches won, sets won, games won, set difference, game difference, and head-to-head.',
              effect:
                'Resolves standings ties in the chosen order; compare it with the published rules.',
            },
            {
              field: 'Match length and break',
              value: 'Set estimated match minutes and the break between matches.',
              effect: 'Guides automatic scheduling; these estimates do not determine match scores.',
            },
            {
              field: 'Tournament rules',
              value: 'Write rules or generate a starting draft and review it.',
              effect:
                'Rules are participant-facing; make sure the text matches categories, phases, scoring, and advancement.',
            },
            {
              field: 'Allow non-member registration',
              value: 'Enable only when event-only guest entries are accepted.',
              effect:
                'Allows public tournament registration without creating a club membership account; the guest email flow and event fee still apply.',
            },
            {
              field: 'Publish participants, teams, schedule, and results publicly',
              value: 'Enable if those competition details should be visible to visitors.',
              effect:
                'Controls public tournament detail visibility; event date, cost, and registration window remain visible. Approved members can still see event details when public competition details are off.',
            },
          ]}
        />
      </Topic>
      <Topic id="admin-event-league" title="Configure a League">
        <FieldTable
          rows={[
            {
              field: 'League gender',
              value: 'Choose Men’s or Women’s.',
              effect:
                'Sets the fixed League category and participant eligibility; registration does not ask for a separate category.',
            },
            {
              field: 'Associate with existing League',
              value: 'Select a same-gender League or leave the selector on creating a new League.',
              effect: 'Associated events share the League identity and cumulative standings.',
            },
            {
              field: 'League name',
              value: 'For a new League, enter its unique name; existing League names are retained.',
              effect: 'Identifies the shared standings group, independent from each event title.',
            },
            {
              field: 'Event dates, registration window, location, capacity, price',
              value: 'Set these separately for each League event.',
              effect:
                'Determines the session schedule, event eligibility window, capacity, and payment.',
            },
            {
              field: 'Scoring and ranking',
              value:
                'Use the supported single round-robin group and review the configured team scoring/ranking rules.',
              effect:
                'Recorded match results feed the event standings and the linked League standings.',
            },
          ]}
        />
        <p>
          Players may enter a later event singly only before they have a fixed League team. Once a
          pair is established, either player registering for a later League event registers both
          teammates together.
        </p>
      </Topic>
      <Topic id="admin-event-team" title="Configure a Team tournament">
        <FieldTable
          rows={[
            {
              field: 'Enabled match categories',
              value: 'Enable Mixed, Men’s, and/or Women’s team-match categories.',
              effect:
                'Categories determine which rostered players are eligible for each category’s match lineup.',
            },
            {
              field: 'Show overall results',
              value:
                'When more than one category is enabled, choose whether to add an Overall results view.',
              effect:
                'Combines each team’s category results and total match points using the configured standings tie-breaks.',
            },
            {
              field: 'Total tournament capacity',
              value:
                'Set the total registered-player capacity; there are no separate team/category registration caps.',
              effect: 'Limits player registrations before team assignment.',
            },
            {
              field: 'Scoring template',
              value: 'Choose the applicable team round-robin or knockout scoring template.',
              effect:
                'The special two-set plus third-set template awards 3 points for a 2–0 win, or 2 and 1 points after a split; other templates omit team points from standings priority.',
            },
            {
              field: 'Group count, team count, promotion and priority',
              value:
                'Set round-robin groups, teams per group, promoted teams if knockout follows, and the ranking priority.',
              effect: 'Determines group assignment, qualification, and tie-breaking.',
            },
            {
              field: 'Captain and player assignment',
              value:
                'Review captain requests, assign a captain, create/edit team name, logo, and color, and assign registered players.',
              effect:
                'A selected captain is assigned to that team; event managers can reassign players and remove a team, which unassigns its players.',
            },
            {
              field: 'Match lineups and visibility',
              value:
                'Create matches between teams, then assign eligible players to each side; choose whether to publish each lineup.',
              effect:
                'Captains can select their own match lineup. Event managers can select either team’s lineup. Published lineups are visible publicly; lineups are shown to viewers once the match starts.',
            },
          ]}
        />
      </Topic>
      <Topic id="admin-event-ladder" title="Configure a Social Doubles Ladder">
        <FieldTable
          rows={[
            {
              field: 'Ladder gender',
              value: 'Choose Men’s or Women’s.',
              effect: 'Sets registration eligibility and which existing Ladder can be associated.',
            },
            {
              field: 'Existing Ladder or Ladder name',
              value: 'Associate with a same-gender Ladder or create a new unique Ladder name.',
              effect:
                'Associated sessions contribute to the same running ranking; session title remains independent.',
            },
            {
              field: 'Position points, first through fourth',
              value: 'Set the points awarded at each position.',
              effect:
                'Awards those points by session finish; tied players receive the same position value.',
            },
            {
              field: 'Ranking criteria and order',
              value:
                'Choose and order Sets won, Games won, Games difference, and Sets difference. At least one criterion is required.',
              effect: 'Ranks entries within the session and resolves ties in the configured order.',
            },
            {
              field: 'Previous Ladder carryover',
              value:
                'Choose Start from zero, Carry over initial positions only, or Carry over positions and points; select the previous Ladder when required.',
              effect: 'Seeds the new Ladder from the chosen previous standings.',
            },
            {
              field: 'Event series and session schedule',
              value: 'Choose the supported recurrence and each session’s registration offsets.',
              effect:
                'Creates sessions under the same Ladder identity; each has its own participant list and results.',
            },
          ]}
        />
        <p>
          When assigning courts, Automatic ladder assignment calculates current Ladder standings,
          then places confirmed players in ranking order in groups of four: the top four on Court 1,
          the next four on Court 2, and so on. The dialog shows the ranking it used. Review or
          adjust the court groups before saving; automatic assignment supports up to four courts,
          and additional courts must be assigned manually.
        </p>
      </Topic>
      <Topic id="admin-event-management" title="Manage registrations, matches, and results">
        <Steps>
          <li>
            Open Events and choose the event. Verify publication, capacity, registration window,
            eligibility, and organizer assignment before sharing the link.
          </li>
          <li>
            Monitor participant payment and confirmation state. For doubles, make pairs from
            compatible registered entries; for League, preserve established teams; for Team
            tournaments, assign registered players to teams.
          </li>
          <li>
            Use the appropriate competition interface to draw groups, create matches, assign courts
            and times, and form team match lineups. Resolve validation warnings rather than
            bypassing a constraint.
          </li>
          <li>
            Enter scores only after the match is eligible for scoring. Scores drive match winners,
            standings, rankings, and advancement.
          </li>
          <li>
            For team events, review the winners in the completion section and announce them only
            when ready; event managers can later unannounce them.
          </li>
        </Steps>
        <p>
          Changes to gender/category configuration can make existing entries ineligible. Before
          editing those settings on an open event, review existing registrations and explain any
          resulting change to affected players.
        </p>
        <p>
          <LinkButton href="/admin/events">Open Events</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-event-editing" title="Edit events and manage participants">
        <p>
          Open an event from Organizer Portal or Admin Portal → Events, or use the pencil next to
          its title when viewing the event page. Save changes to update the event. When editing one
          session in a recurring series, you can apply shared fields—such as title, description,
          publication, capacity, price, location, eligibility, waitlist, and available courts—to all
          sessions. Dates, participant records, and court assignments for other sessions remain
          separate.
        </p>
        <Steps>
          <li>
            Use the registered-member selector to add an eligible member. The event’s normal
            capacity, membership, and gender rules still apply; the member may be waitlisted if the
            event is full and its waitlist is enabled.
          </li>
          <li>
            Remove a player only when needed. If they have a court assignment or recorded score, the
            confirmation explains that assignments will be removed and score history may be
            affected. Removing a confirmed player can promote someone from the waitlist.
          </li>
          <li>
            To preserve a place, use Replace player on the confirmed player’s row, select the
            replacement, and confirm. This transfers court assignments and score references where
            applicable, instead of removing the old registration and creating an unrelated one.
          </li>
        </Steps>
        <Callout>
          A waitlisted replacement is promoted to confirmed immediately, even if they were not first
          in the queue. The confirmation also warns if the selected replacement is suspended for the
          event date. Check the player, event, assignments, and score history before confirming.
        </Callout>
      </Topic>
      <Topic id="admin-event-replacement" title="Replace an event participant carefully">
        <p>
          Replace player is designed to transfer a place from one confirmed member to another while
          keeping the event record connected. Choose the replacement from the available member list;
          already registered players are not offered. Confirm the change only after checking that
          the replacement is eligible and has agreed to participate.
        </p>
        <p>
          Existing court assignments and score references are transferred where applicable. If the
          replacement was waitlisted, they move directly to confirmed ahead of the remaining queue.
          A suspended-member warning requires deliberate confirmation. Use Remove when the place
          should be vacated instead; the waitlist can then be promoted normally.
        </p>
      </Topic>
      <Topic id="admin-event-courts" title="Assign courts for a regular event">
        <Steps>
          <li>
            Open the event’s management page and choose Assign courts. The court count set in event
            configuration determines the available court columns.
          </li>
          <li>
            Drag each confirmed participant into a court for each sub-session. Every confirmed
            participant must appear exactly once in every sub-session; waitlisted participants are
            not assigned until confirmed.
          </li>
          <li>
            Add sub-sessions when the event needs another rotation. New sub-sessions copy the first
            one as a starting point; adjust the assignments so every confirmed participant appears
            once in each.
          </li>
          <li>
            Review any assignment warnings, then save. If warnings remain, you can confirm saving
            them only after checking the court/player conflicts.
          </li>
        </Steps>
        <p>
          Court assignments are locked more than two days after the session ends. Removing a player
          who has an assignment warns that the assignment will be removed; replacements transfer
          assignments where applicable.
        </p>
      </Topic>
    </div>
  );
}
