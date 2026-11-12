'use client';

import {
  Callout,
  FieldTable,
  LinkButton,
  SectionNav,
  Steps,
  Topic,
} from '@/components/help-guide-primitives';
import { helpTopicLinks, useHelpGuideNavigation } from '@/components/help-guides/navigation';
import { useSiteHeaderState } from '@/components/site-header-state';

const tabs = [
  ['dashboard', 'Dashboard'],
  ['profile', 'Profile'],
  ['membership', 'Membership'],
  ['events', 'Events'],
  ['competitions', 'Competitions'],
  ['results', 'Results & rankings'],
  ['resources', 'Resources & chat'],
] as const;

const topics = [
  ['dashboard', 'member-dashboard', 'Dashboard and activity'],
  ['profile', 'member-profile', 'Profile and eligibility'],
  ['membership', 'member-membership', 'Season membership and waiver'],
  ['membership', 'member-family', 'Set up or leave a family'],
  ['membership', 'member-membership-payment', 'Pay membership fees'],
  ['membership', 'member-payment-history', 'Payment history'],
  ['events', 'member-event-registration', 'Register and withdraw'],
  ['events', 'member-event-payments', 'Pay event fees'],
  ['events', 'member-event-scores', 'Report event scores'],
  ['competitions', 'member-tournament-entry', 'Tournament registration'],
  ['competitions', 'member-pair-registration', 'Register and pay with a partner'],
  ['competitions', 'member-league-entry', 'League registration'],
  ['competitions', 'member-ladder-entry', 'Social Doubles Ladder'],
  ['competitions', 'member-team-captain', 'Team tournament captain workflow'],
  ['results', 'member-results', 'Results'],
  ['results', 'member-rankings', 'Rankings and standings'],
  ['resources', 'member-gallery-documents', 'Gallery and Documents'],
  ['resources', 'member-chat', 'Member chat'],
] as const;

export function MemberHelpTopicNav() {
  return <SectionNav ariaLabel="Member help topics" collapsible links={helpTopicLinks(topics)} />;
}

export function MemberHelpGuide() {
  const { shortName } = useSiteHeaderState();
  const { activeTab, selectTab } = useHelpGuideNavigation(tabs, topics, 'dashboard');

  return (
    <section id="member-guide" className="scroll-mt-24 space-y-6">
      <div role="tablist" aria-label="Member help sections" className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`member-help-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="member-help-panel"
            onClick={() => selectTab(id)}
            className={`rounded-md border px-4 py-2 text-sm ${activeTab === id ? 'border-primary bg-secondary font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="member-help-panel"
        role="tabpanel"
        aria-labelledby={`member-help-tab-${activeTab}`}
        className="space-y-5"
      >
        {activeTab === 'dashboard' && <DashboardTopic />}
        {activeTab === 'profile' && <ProfileTopic shortName={shortName || 'club'} />}
        {activeTab === 'membership' && <MembershipTopics />}
        {activeTab === 'events' && <EventTopics />}
        {activeTab === 'competitions' && <CompetitionTopics />}
        {activeTab === 'results' && <ResultsTopics />}
        {activeTab === 'resources' && <ResourceTopics />}
      </div>
    </section>
  );
}

function DashboardTopic() {
  return (
    <Topic id="member-dashboard" title="Dashboard and activity overview">
      <p>
        The Member dashboard summarizes your account and club activity. Membership overview shows
        the current season, your membership type, and payment state. My activity overview counts
        upcoming registrations, confirmed events, and recorded results; My event registrations lists
        upcoming sessions with their current registration status. Open an event from its link to
        review details or take an available action.
      </p>
      <p>
        An account whose membership application is not approved sees its application state and
        relevant next steps instead of the full member dashboard. Approval is separate from paying
        dues. A suspension notice, if present, explains that account restriction.
      </p>
      <p>
        <LinkButton href="/member/dashboard">Open Member dashboard</LinkButton>
      </p>
    </Topic>
  );
}

function ProfileTopic({ shortName }: { shortName: string }) {
  return (
    <Topic id="member-profile" title="Profile information and eligibility">
      <FieldTable
        rows={[
          {
            field: 'Name, phone, birthday, and gender',
            value:
              'Keep contact details current. Name, phone, date of birth, gender, and skill rating are required profile fields.',
            effect:
              'Name and contact information identify you to club organizers. Gender affects eligibility for gender-specific events and category checks in competitions. Birthday and its visibility option support the club birthday display.',
          },
          {
            field: 'Tennis skill rating',
            value: 'Choose the rating that best reflects your current level.',
            effect:
              'Your selected skill rating appears with your name in participant and results displays that show player details.',
          },
          {
            field: 'Avatar and playing hand',
            value: 'Upload an avatar and choose your playing hand if desired.',
            effect:
              'The avatar identifies you in player lists; playing hand just is profile information not used anywhere.',
          },
          {
            field: 'Email preferences and chat notifications',
            value: 'Choose the automated event and club email categories you want.',
            effect:
              'Preferences control routine notification emails. Administrators can still send important club-wide announcements regardless of these settings.',
          },
          {
            field: 'Show birthday emoji',
            value: 'Enable or disable the profile option.',
            effect:
              'When enabled, the cake indicator is shown beside your player identity on all pages.',
          },
        ]}
      />
      <div className="space-y-3">
        <h4 className="font-semibold">Emails managed by these preferences</h4>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Registration and withdrawal confirmations:</strong>{' '}
            {'“{club short name} — Registration confirmed: {event title}”'};{' '}
            {'“{club short name} — You’re on the waitlist: {event title}”'};{' '}
            {'“{club short name} — Your event registration”'};{' '}
            {'“{club short name} — Your event registration was cancelled”'}; and League{' '}
            {'“Registration confirmed: {event title}”'}.
          </li>
          <li>
            <strong>Waitlist promotion confirmations:</strong> “{shortName} — Your place in an event
            is confirmed”.
          </li>
          <li>
            <strong>Event cancellation notifications:</strong> “{shortName} — Event cancelled”.
          </li>
          <li>
            <strong>Registration reminders:</strong> {'“Registration is open: {event title}”'};{' '}
            {'“Payment required to keep your place: {event title}”'}; and{' '}
            {'“Final reminder: event payment due soon — {event title}”'}.
          </li>
          <li>
            <strong>New event announcements:</strong> “{shortName} — New event announced”.
          </li>
          <li>
            <strong>Newsletter and club news:</strong> custom-subject announcements sent to the
            Newsletter subscribers audience.
          </li>
        </ul>
      </div>
      <div className="space-y-3">
        <h4 className="font-semibold">Other emails are not controlled by these preferences</h4>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase Auth:</strong> account invitations, passwordless sign-in links, and
            event-guest sign-in links are sent directly by Supabase Auth.
          </li>
          <li>
            <strong>Tournament partner invitation:</strong> “Confirm your place with
            {' {inviting player’s name}'}”.
          </li>
          <li>
            <strong>Family membership invitation:</strong> “{shortName} family membership
            invitation”.
          </li>
          <li>
            <strong>Membership renewal:</strong> “{shortName} membership renewal is coming up” and “
            {shortName}
            membership fee reminder”.
          </li>
          <li>
            <strong>Interac payment messages:</strong> “{shortName} Interac payment instructions”, “
            {shortName}
            Interac payment confirmed”, and “{shortName} Interac payment requires attention”.
          </li>
          <li>
            <strong>Application approval:</strong> “Your {shortName} application has been approved”.
          </li>
          <li>
            <strong>Administrator announcements:</strong> important emails to broad audiences (All
            approved members, Active members, Administrators, or Organizers) ignore profile
            preferences. The Newsletter subscribers audience does respect the newsletter preference.
          </li>
        </ul>
      </div>
      <p>
        <LinkButton href="/member/profile">Edit my profile</LinkButton>
      </p>
    </Topic>
  );
}

function MembershipTopics() {
  return (
    <>
      <Topic id="member-membership" title="Season membership and your waiver">
        <p>
          Membership is managed by club season. The page shows the configured season dates, your
          individual or family plan, current status, and the applicable fee. Account approval and
          payment are separate: approval gives member access, while payment satisfies the season
          dues requirement for features that require paid membership.
        </p>
        <p>
          Read the current waiver and press{' '}
          <strong>I have read and accept the current membership waiver</strong> to record your
          individual acceptance. The page then shows the acceptance date. Waiver acceptance is saved
          independently from checkout, so it remains recorded if you pay later. Each adult family
          member accepts their own waiver; there is no family-wide waiver.
        </p>
        <Callout>
          The Membership menu shows a warning badge while your membership is unpaid. Once payment is
          confirmed, the page and badge update to the paid state.
        </Callout>
        <p>
          <LinkButton href="/member/membership">Open Membership</LinkButton>
        </p>
      </Topic>
      <Topic id="member-family" title="Invite members to a family plan">
        <Steps>
          <li>
            In Membership, use the family section to invite an existing approved member. If you do
            not yet have a family, creating it sends the first invitation; otherwise invite the
            additional eligible member from the current family.
          </li>
          <li>
            The invited member signs in, accepts the invitation, and accepts their own current
            membership waiver. Until the invitation and individual waiver are complete, family
            membership is shown as pending and family checkout is unavailable.
          </li>
          <li>
            Once all family confirmations and waivers are complete, an eligible family member can
            pay the family fee. The family becomes paid after Stripe confirms the card payment or an
            administrator confirms the Interac transfer.
          </li>
          <li>
            Use the family controls to review membership, send an available invitation, or leave /
            remove a member. If a paid family member schedules departure, the page explains when it
            takes effect; an active paid season remains in force through its end date.
          </li>
        </Steps>
        <p>
          <LinkButton href="/member/membership">Manage family membership</LinkButton>
        </p>
      </Topic>
      <Topic id="member-membership-payment" title="Pay membership fees by card or Interac">
        <h4 className="font-semibold">Stripe card payment</h4>
        <p>
          Choose the available membership payment option. Stripe opens its hosted checkout; the app
          marks payment complete only after it receives and verifies Stripe confirmation. If
          checkout is cancelled or still processing, check the displayed status or payment history
          before starting another attempt.
        </p>
        <h4 className="font-semibold">Interac e-Transfer</h4>
        <p>
          Choose the applicable Interac option to submit a payment request, then use{' '}
          <strong>View Interac instructions</strong> to see the recipient, amount, and reference.
          Send the exact amount with that reference. Interac is not automatically confirmed:
          membership remains unpaid until the club reviews and confirms receipt. Reopening the
          instructions does not create another request.
        </p>
        <p>
          For a family plan, the family price is charged once. For an individual plan, use the
          individual amount shown on screen. Always check the amount and payment status before
          transferring funds.
        </p>
      </Topic>
      <Topic id="member-payment-history" title="Review payment history">
        <p>
          Payments lists recorded charges and requests with purpose, related event or membership,
          amount, method, status, and dates. Pending Interac means the club has not confirmed the
          transfer. Succeeded indicates confirmation; refunded or partially refunded indicates a
          recorded refund. A refunded membership payment returns that membership to unpaid.
        </p>
        <p>
          <LinkButton href="/member/payments">Open payment history</LinkButton>
        </p>
      </Topic>
    </>
  );
}

function EventTopics() {
  return (
    <>
      <Topic id="member-event-registration" title="Register for an event or withdraw">
        <Steps>
          <li>
            Browse Events and open the event page to check its date, registration window, fee, and
            eligibility.
          </li>
          <li>
            Register using the available choices. Depending on event configuration, the form may ask
            for a category, individual / partner entry, or party +1 choice. Provide the requested
            partner details accurately; a partner confirmation may be required before a team becomes
            eligible for payment.
          </li>
          <li>
            Review the resulting status. A full event may place you on its waitlist if enabled;
            payment options appear when payment is due. Registration confirmation and payment are
            separate statuses.
          </li>
          <li>
            To leave, use Withdraw on the event page and confirm in the app dialog. For a paid,
            confirmed pair/team entry, withdrawal may apply to the whole team as stated in the
            confirmation. A released place may promote a waitlisted player.
          </li>
        </Steps>
        <p>
          <LinkButton href="/events">Browse events</LinkButton>
        </p>
      </Topic>
      <Topic id="member-event-payments" title="Pay event fees by card or Interac">
        <p>
          After your registration is confirmed, the event page shows <strong>Pay</strong> when a
          balance is due. The amount is based on your registration: a party may add the configured
          guest fee for +1, while a free member place can still have a charge for the guest. Check
          the amount shown beside the event and in the payment choice before paying.
        </p>
        <h4 className="font-semibold">Stripe card payment</h4>
        <p>
          Select the card option to open Stripe’s hosted checkout. The app marks the event payment
          paid after Stripe confirms and the registration is fulfilled. If a prior card attempt is
          still pending, the option lets you check its status; if it was cancelled or failed, you
          can start another attempt. The event page shows a pending state while payment is
          unresolved, and warns that an unpaid place may be removed.
        </p>
        <h4 className="font-semibold">Interac e-Transfer</h4>
        <p>
          Select Interac to create a payment request, then review the instructions dialog for the
          exact amount, recipient, and unique reference. Send the transfer using that reference.
          Your registration remains unpaid and the page shows that the request is awaiting club
          confirmation. Use <strong>View Interac instructions</strong> to reopen the existing
          instructions; it does not create a second request. The club must confirm receipt before
          the payment is marked paid.
        </p>
        <Callout>
          Event fees are separate from annual membership dues. A paid membership does not
          automatically pay an event fee; pay only the amount shown for the event registration.
        </Callout>
      </Topic>
      <Topic id="member-event-scores" title="Report scores for a club event">
        <Steps>
          <li>Open the event page and locate its Scores section after the match has started.</li>
          <li>
            Select the court or session and the match participants requested by the form. In a
            doubles event, select your partner; the opponent side is determined from the event
            registrations.
          </li>
          <li>
            Enter the score in the displayed format and save it. The result is used in event results
            and eligible player rankings.
          </li>
          <li>
            The person who submitted a result or an event manager can make permitted corrections. If
            score entry is unavailable, check the event start time, your confirmed registration, and
            whether score entry has been locked.
          </li>
        </Steps>
        <Callout>
          Only enter a score agreed by the players. A saved score changes recorded results and
          standings.
        </Callout>
      </Topic>
    </>
  );
}

function CompetitionTopics() {
  return (
    <>
      <Topic id="member-tournament-entry" title="Register for a tournament">
        <p>
          Tournament registration choices depend on its format and the organizer’s settings. A
          doubles event may offer enabled gender categories and individual or partner registration.
          A team tournament normally registers each player once; organizers or captains then assign
          players to teams. Public guest registration is available only on tournaments configured to
          accept it.
        </p>
        <p>
          For a partner entry, select an existing member or provide the guest details the form
          requests. The invited partner may need to confirm participation before the team can pay.
          Once payment options are available, each partner may pay their share or one partner may
          pay for both; the page shows the available choices and outstanding amount. A category,
          partner, or other required choice may send the Register button to the event page form.
        </p>
        <p>
          Tournament pages can show groups, draws, schedules, results, standings, and published
          lineups as they become available. Event details marked private are visible to members
          according to the event’s publication settings.
        </p>
      </Topic>
      <Topic id="member-pair-registration" title="Register and pay with a partner">
        <h4 className="font-semibold">Create a pair entry</h4>
        <Steps>
          <li>
            Open the tournament and choose an enabled category. Select{' '}
            <strong>Register with a partner</strong> when the form offers that mode; category and
            gender eligibility checks apply to both players.
          </li>
          <li>
            Choose an existing member from the partner selector, or choose to add a non-member and
            enter their name and email (plus any other fields requested). If the email belongs to a
            member, they are notified to confirm; a non-member receives a one-time sign-in link to
            review their details and confirm. The team cannot pay until the partner confirms.
          </li>
          <li>
            After submitting, check your registration card for the partner’s name and whether their
            confirmation is pending or complete. While confirmation is pending, you can change the
            partner, or switch to a single entry if the tournament permits it and the registration
            window is still open.
          </li>
        </Steps>
        <h4 className="font-semibold">Accept an invitation</h4>
        <Steps>
          <li>
            Open Events and find the “Tournament invitations awaiting your confirmation” block. A
            pending-invitation badge also appears in the Events menu. Follow the link for the
            tournament that invited you.
          </li>
          <li>
            Review the displayed name, email, phone, gender, skill rating, and the name of the
            player who invited you. Press <strong>Confirm participation</strong> to accept the
            partner entry. This confirms your place in the pair; it does not pay the fee.
          </li>
          <li>
            Once confirmed, either partner can use the registration’s <strong>Pay</strong> menu.
            Choose the option for yourself to pay your share, or for both partners to pay the
            combined amount in one transaction. “For both” is available only when both shares are
            unpaid; if one partner has already paid, the other is not charged for that share again.
          </li>
        </Steps>
        <p>
          The available payment methods depend on event settings. Card opens Stripe checkout;
          Interac creates a request with instructions and remains pending until the club confirms
          receipt. See{' '}
          <a
            className="font-medium text-primary underline"
            href="?tab=events#member-event-payments"
          >
            Pay event fees
          </a>{' '}
          for the full payment status and instruction flow.
        </p>
        <Callout>
          A fixed League team registering for a later League event follows the League rule instead:
          either teammate registers both players, and the partner does not need to confirm that
          later-event entry.
        </Callout>
      </Topic>
      <Topic id="member-league-entry" title="Register for League events">
        <p>
          A League uses fixed partners across its later events. A confirmed team sees{' '}
          <strong>Register my team</strong>; either teammate can register the whole team, and the
          second player does not need to confirm the later-event entry. Withdrawing from that entry
          withdraws the team.
        </p>
        <p>
          A player without a fixed team can register as a new player under the choices allowed by
          the League. An organizer can assign a partner/team; once assigned, subsequent League
          events use the fixed-team registration rule. The League’s configured gender determines its
          category, so there is no category selection on the registration form.
        </p>
        <p>
          Review the event’s registration, payment, schedule, and standings sections for your
          current status. League match results contribute to event and League standings after they
          are recorded.
        </p>
      </Topic>
      <Topic id="member-ladder-entry" title="Join and play a Social Doubles Ladder">
        <p>
          Register for each published Ladder session during its registration window. The session
          category checks your profile gender. Once entries are set, players are allocated to courts
          and subsessions according to the Ladder’s setup; automatic court assignment groups players
          for that session. Play the scheduled matches and report scores on the session page where
          score entry is available.
        </p>
        <p>
          Ladder standings use the configured ranking metrics and points for session positions.
          Season views may carry forward seeded positions or prior points as shown by the
          competition rules.
        </p>
      </Topic>
      <CaptainTopic />
    </>
  );
}

function CaptainTopic() {
  return (
    <Topic id="member-team-captain" title="Team tournament: captain match workflow">
      <p>
        A captain is also a registered player. In the tournament’s Matches tab, captains see only
        matches involving their team. They can review the match list and schedule, but cannot create
        matches or change the teams, court, or date/time assigned by the organizer.
      </p>
      <Steps>
        <li>
          For each match, choose two eligible registered players from your own assigned team,
          including yourself if you are playing. The tournament category constrains the lineup; for
          example, a mixed match requires the configured gender combination. The same player cannot
          fill both positions.
        </li>
        <li>
          Optionally check{' '}
          <strong>Show this lineup to everyone on the public tournament page</strong>
          before saving. If it is not published, your team’s members can still see the lineup. The
          opposing side is shown to other viewers only when its visibility is enabled; lineups are
          revealed to permitted viewers once the match start time has passed.
        </li>
        <li>
          When the match is ready for scoring, enter the agreed result in its result area and save.
          A successful save confirms the result and updates tournament results, team points where
          the selected scoring template awards them, and standings. Use the pencil control on a
          saved result to edit it when permitted.
        </li>
      </Steps>
      <Callout>
        Captains can set their own team’s lineup only. The organizer controls match creation,
        scheduling, courts, and the opposing team’s lineup.
      </Callout>
    </Topic>
  );
}

function ResultsTopics() {
  return (
    <>
      <Topic id="member-results" title="Read your Results page">
        <p>
          Results summarizes recorded performance for a selected season or All time. Summary cards
          show overall and, when gender is on your profile, gender ranking, plus sets and games won
          and lost and win percentages. The match list shows date, event, partner/opponents, score,
          and outcome. Future-dated scores are excluded.
        </p>
        <p>
          The season selector follows the club’s configured membership seasons and includes All
          time. Only seasons and events with available data are offered. Results require an approved
          member with paid membership on record; administrators retain access.
        </p>
        <p>
          <LinkButton href="/member/results">Open Results</LinkButton>
        </p>
      </Topic>
      <Topic id="member-rankings" title="Use Rankings and competition standings">
        <p>
          Rankings compares players and competition entries using each format’s rules. Choose a
          season or All time, then a player ranking, Ladder, League, or tournament where available.
          Player rankings can be filtered by gender and sorted by table columns; sorting changes
          display order, not the calculated rank. Your row is highlighted.
        </p>
        <p>
          Ladder tables use their configured performance metrics and position points. League and
          tournament standings are based on their recorded match outcomes, scoring rules, and
          configured tie-breaks. A standings table may be absent until the competition has results.
        </p>
        <p>
          <LinkButton href="/rankings">Open Rankings</LinkButton>
        </p>
      </Topic>
    </>
  );
}

function ResourceTopics() {
  return (
    <>
      <Topic id="member-gallery-documents" title="Gallery and Documents">
        <p>
          Gallery contains published albums. Public albums are open to visitors; members-only albums
          require the applicable member access. Select an image to open the viewer and move through
          the album.
        </p>
        <p>
          Documents contains club resources such as bylaws and meeting minutes. Search by document
          name, change the sort order, and download the available PDF. Access to member documents
          requires an approved account with paid membership or administrator access.
        </p>
        <p className="flex flex-wrap gap-4">
          <LinkButton href="/gallery">Open Gallery</LinkButton>
          <LinkButton href="/documents">Open Documents</LinkButton>
        </p>
      </Topic>
      <Topic id="member-chat" title="Member chat">
        <p>
          Chat is available to approved members. It is a shared club coordination space; mentions
          can notify a named member according to their notification settings. The unread-count badge
          appears in the portal navigation and updates as messages are read.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Compose a message',
              value: 'Enter the message; Enter sends and Ctrl+Enter inserts a line break.',
              effect: 'The message is shared with the members who can access the chat.',
            },
            {
              field: 'Attach an image',
              value: 'Use a supported JPEG, PNG, GIF, or WebP image up to 1 MB.',
              effect: 'The uploaded image is displayed with the message.',
            },
            {
              field: 'Edit or delete your message',
              value: 'Use the message menu within five minutes of posting.',
              effect: 'Only your own recent message can be changed or removed by you.',
            },
          ]}
        />
        <p>
          <LinkButton href="/member/chat">Open Member chat</LinkButton>
        </p>
      </Topic>
    </>
  );
}
