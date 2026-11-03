import { FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function MemberHelpGuide() {
  return (
    <section id="member-guide" className="mt-14 scroll-mt-24 space-y-4">
      <div className="max-w-3xl">
        <p className="eyebrow">Approved members</p>
        <h2 className="text-2xl font-semibold tracking-tight">
          Your account, entries, and payments
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Use Member Portal for profile, Membership, Payments, Results, and eligible member tools.
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
            Press Register. The event procedure records a confirmed place or waitlist status. For a
            paid event, follow the payment action shown on the event page.
          </li>
          <li>
            If a waitlist is enabled and the event is full, your place remains waitlisted until
            promoted; waitlisted entries are not charged by ordinary event checkout.
          </li>
          <li>
            To leave, choose Withdraw and read the event-specific confirmation. The app may promote
            a waitlisted member after a confirmed place is released.
          </li>
        </Steps>
        <p>
          <LinkButton href="/events">Find an event</LinkButton>
        </p>
      </Topic>
      <Topic id="member-competitions" title="Enter a tournament, Ladder session, or League event">
        <h4 className="font-semibold">Doubles tournaments</h4>
        <Steps>
          <li>
            Choose an enabled category (Mixed, Men’s, or Women’s) if the tournament offers more than
            one. The selected category determines the eligibility check and the entry’s category
            capacity.
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
            partner entries can be paid in a single Stripe checkout; do not assume your partner is
            paid unless the page reports team payment complete.
          </li>
        </Steps>
        <h4 className="font-semibold">Social Doubles Ladder</h4>
        <p>
          Register for each published Ladder session like an event. The Ladder gender setting makes
          the session Men’s or Women’s and checks profile gender for eligibility. Players are
          assigned to courts/subsessions; results rank players by the Ladder’s selected metrics and
          award the configured position points.
        </p>
        <h4 className="font-semibold">League</h4>
        <p>
          A League uses fixed teams throughout the season. A player with a confirmed League team
          sees <strong>Register my team</strong>; either partner can press it, and both teammates
          are entered together. If you are a new League player with no team yet, either register
          your team for the next available event, or use the single-player registration offered on
          the event page; an organizer can assign your partner later. Withdrawing from an
          established team entry withdraws both partners after confirmation.
        </p>
        <p>
          Payment status is shown per entry and for the team. Pay for both players only when both
          are unpaid; a prior paid partner is not charged twice.
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
            Review the season dates and single-membership price shown. Choose Stripe card checkout
            or Interac if that option is enabled.
          </li>
          <li>
            For Stripe, complete the hosted checkout. The return page checks Stripe’s confirmation
            and only then activates/marks the membership paid. If the page says processing, wait and
            check Payment History before trying again.
          </li>
          <li>
            For Interac, send the exact amount to the shown recipient using the unique reference and
            administrator instructions. This is a manual transfer; your membership remains pending
            until an administrator confirms receipt.
          </li>
        </Steps>
        <h4 className="font-semibold">Family membership</h4>
        <Steps>
          <li>
            Invite each intended family member from Membership. They must accept the invitation and
            have an approved account before they are a confirmed family member.
          </li>
          <li>
            Every confirmed family member must accept the current waiver. Check the family member
            list for the waiver-accepted status before checkout.
          </li>
          <li>
            The payer chooses family Stripe checkout or, when enabled, family Interac. The family is
            not marked paid until Stripe confirms or an administrator confirms the transfer.
          </li>
        </Steps>
        <h4 className="font-semibold">Read a payment record</h4>
        <p>
          Member → Payments lists purpose, amount, method, status, date, and refund information.
          “Pending” means no final payment confirmation; “Succeeded” is the processor confirmation;
          “Refunded” and “Partially refunded” reflect a recorded refund. For Interac, the reference
          shown in the instructions identifies the transfer to the club.
        </p>
        <p>
          <LinkButton href="/member/membership">Membership and family plan</LinkButton>
          <span className="mx-2 text-muted-foreground">·</span>
          <LinkButton href="/member/payments">Payment history</LinkButton>
        </p>
      </Topic>
      <Topic id="member-results" title="Read your Results page">
        <p>
          Results summarizes your recorded match performance for a selected membership season or all
          time. The top cards show your overall rank and, when your profile has a gender set, your
          rank among players of that gender. The Sets and Games cards show won/lost totals and win
          percentages for the chosen period.
        </p>
        <p>
          The score list is newest first and shows the event, date, partner, opponents, score, and
          whether the recorded result is a win, loss, or draw. It includes recorded event scores and
          tournament set results; future-dated scores are excluded. If no eligible results are
          available for the period, the page reports that instead of inventing a rank.
        </p>
        <p>
          Use the season selector to compare a season with All time. The season boundary comes from
          the club’s membership-season settings. Results and rankings require an approved account
          with a paid membership on record; approved administrators do not need a paid membership
          for access.
        </p>
        <p>
          <LinkButton href="/member/results">Open my Results</LinkButton>
        </p>
      </Topic>
      <Topic id="member-rankings" title="Explore Club rankings and competition standings">
        <p>
          Club rankings is the broader comparison view. Choose a full season or all time, a Social
          Doubles Ladder, a League, or a tournament from the Competition selector. The selected view
          changes the table because each competition has its own ranking rules.
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
          The club rankings page is available to approved members with a paid membership on record
          and to administrators. A competition without scored results may not appear as an option
          yet.
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
          Documents contains club bylaws, minutes, and other uploaded member resources. It requires
          an approved paid member account or administrator access. Search by document name, choose
          newest-first or alphabetical sorting, then use Download PDF. If a file is unavailable, try
          again later or contact the club with the document title.
        </p>
        <p className="flex flex-wrap gap-4">
          <LinkButton href="/gallery">Open Gallery</LinkButton>
          <LinkButton href="/documents">Open Documents</LinkButton>
        </p>
      </Topic>
      <Topic id="member-chat" title="Member chat: image, mention, and message controls">
        <p>
          The member chat is a shared space for approved members. Use it for club coordination and
          include enough event context that other members can understand what you mean.
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
              effect: 'Your message can be edited or deleted only within five minutes of posting.',
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
  );
}
