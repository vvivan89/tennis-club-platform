import Link from 'next/link';
import { FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminHelpGuide() {
  return (
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
          The Admin dashboard is a club-wide monitoring view. Its member card summarizes the profile
          count plus paid, overdue, and pending membership counts. Its event card summarizes
          published events in the configured season. Attendance statistics group sessions with the
          same event title and compare registrations at cutoff with capacity, vacant places,
          waitlisted entrants, and promotions.
        </p>
        <p>
          The overdue-membership table identifies approved members whose latest membership has an
          active or expired status and no recorded payment. Treat these as review queues: open
          Membership or Payments to inspect the underlying record before contacting a member or
          changing their status. The dashboard summarizes current data; membership, event, and
          payment pages are where you make changes.
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
          . In addition, the Organizer selector determines who owns the event operationally: assign
          the organizer before publishing if they will manage entrants, courts, and results.
        </p>
        <p>
          When applying shared changes to a recurring series, the form updates title, description,
          gender restriction, publication, capacity, price, location, membership requirement,
          waitlist, and available courts. It does <strong>not</strong> change other sessions’ dates,
          participants, or court assignments.
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
          associate each League event with the correct standings record, and verify that scoring and
          ranking settings agree with the published rules. Admins can manage events across
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
            For League events, connect every event to the intended League record. A new name creates
            a new standings identity; a wrong association splits or combines results incorrectly.
          </li>
          <li>
            Review the scoring template and ranking criteria against the rules text. Scores drive
            match winners, advancement, event standings, and League cumulative standings.
          </li>
          <li>
            Keep guest registration disabled unless the event is intentionally open without
            accounts. Guests use card checkout; they cannot submit Interac through the guest flow.
          </li>
        </Steps>
      </Topic>
      <Topic id="admin-ranking-controls" title="How results become rankings and standings">
        <p>
          The Rankings page is calculated from recorded results; it is not a spreadsheet where an
          admin directly edits each player’s overall rank. Correct the source record when a score or
          participant is wrong, then review the competition view after it recalculates.
        </p>
        <Steps>
          <li>
            For player rankings and Member Results, check that the event score or tournament set
            result has the right players, side, score, and played date. Future-dated scores do not
            count yet. These records supply wins, losses, games, and sets.
          </li>
          <li>
            For a tournament, the event’s scoring template validates results and drives match
            winners, group tables, and knockout advancement. If correcting a group placement or
            promotion exception, use the event standings override and give the required reason; the
            override is retained in audit history.
          </li>
          <li>
            For a League, confirm each event points to the intended League record. Its current table
            aggregates team results across associated League events; a wrong association can split
            or combine standings.
          </li>
          <li>
            For a Social Doubles Ladder, check the session scores and the Ladder’s position points,
            ranking metrics, and carryover settings. Session results and configured tie-breaks
            determine points and the order in the Ladder table.
          </li>
        </Steps>
        <p>
          The default player ranking sorts by games-won percentage, then total games won, recorded
          result count, and player name. Changing a table’s display sort does not change the
          calculated rank. Use the player Results page and the relevant competition selector to
          verify the period or standings you are investigating.
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
            both partners). The server checks ownership, amount, membership/registration state, and
            creates a pending payment record before opening Stripe Checkout.
          </li>
          <li>
            The payer completes card checkout on Stripe. The app returns to the payment status page,
            which checks the Checkout Session and PaymentIntent, then finalizes the membership or
            registration after Stripe confirms success. A canceled or failed checkout does not
            fulfill it.
          </li>
          <li>
            Tell the payer to check Member → Payments or the event page if the status is processing.
            Avoid creating a second payment while the existing checkout is open; the app prevents
            duplicate active attempts for the same record.
          </li>
        </Steps>
        <h4 className="font-semibold">What a player does with Interac</h4>
        <Steps>
          <li>
            Interac appears only when enabled by an administrator and for a signed-in, approved
            payer. The app creates a pending payment request and shows the amount, recipient email,
            unique payment reference, and administrator-provided transfer instructions.
          </li>
          <li>
            The payer sends the transfer using those instructions and includes the reference exactly
            as shown. The app does not receive a bank confirmation automatically; membership or
            registration remains unpaid/pending.
          </li>
          <li>
            The administrator matches the received funds to the payment row and confirms it. Only
            then does the app mark the payment successful and fulfill the linked membership or event
            entry. If the transfer is not found or the amount/reference is wrong, leave it pending
            and follow up before confirming.
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
            Filter the Interac table and match the submitted amount, payer, purpose, and reference
            against the incoming transfer.
          </li>
          <li>
            Choose Confirm only after receipt is verified. Choose Reject when the request is invalid
            or not received; enter the required internal note so the member record has a reason.
          </li>
          <li>
            For Stripe refunds, refund only a succeeded or partially refunded payment with
            refundable balance. Enter the refund amount/reason in the refund form; the recorded
            refund updates the status and remaining refundable amount. Confirmed Interac payments
            have a separate manual-refund action because no card processor can reverse the transfer.
          </li>
        </Steps>
        <p>
          Payments → Report can filter by year, payment category, and method, then export matching
          rows as CSV. Stripe fees and net proceeds are shown where recorded; historical figures may
          be estimated when processor fee data is unavailable.
        </p>
        <p>
          <LinkButton href="/admin/payments">Open Payments</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-members" title="Applications, member records, and membership plans">
        <Steps>
          <li>
            Review new applications in Admin → Membership → Applications. Check applicant details,
            then approve or reject using the application action; approval changes access to member
            pages.
          </li>
          <li>
            In Members, use search and the member record to correct contact details, role/status,
            skill rating, or gender where permitted. Role changes affect portal access; gender
            affects eligibility for gender-specific events and mixed doubles. The skill rating
            appears alongside tournament player/pair information where that information is shown.
          </li>
          <li>
            Membership Types controls the displayed single/family price, family adult/child limits,
            and season dates. Recheck the amount and term before saving because new checkout
            requests use those settings.
          </li>
          <li>
            For a family payment, every confirmed family member must have an approved profile and
            accept the current waiver. If the waiver version changes, the family must accept the
            current version before checkout can be fulfilled.
          </li>
          <li>
            Use invitation controls to create/send an invitation with the intended role. Verify the
            recipient address and role before sharing the link.
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
  );
}
