import { Callout, FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminMembershipGuide() {
  return (
    <div className="space-y-5">
      <Topic id="admin-applications" title="Review membership applications">
        <p>
          New member accounts are not approved members until an administrator accepts the
          application. Pending applications are available in Membership → Applications and are
          excluded from member directories, player selectors, rankings, and member counts.
        </p>
        <Steps>
          <li>
            Open Applications and review the applicant’s name, contact details, and application
            comment.
          </li>
          <li>
            Approve only when the application is ready to join the club; otherwise decline it.
          </li>
          <li>
            After either action, you will notice that the application leaves the pending queue and
            the pending badge updates.
          </li>
        </Steps>
        <p>
          <LinkButton href="/admin/members?tab=applications">Open Applications</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-invite-member" title="Invite a new member">
        <p>
          Admins can invite members to join the club by sending them an invitation via email. The
          invited person must follow the email link to confirm and complete their account setup.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Full name, email, and phone',
              value:
                'Enter all three required values; verify the email address because the invitation is sent there.',
              effect:
                'Prepares the invited profile and gives the member the contact details associated with the account.',
            },
            {
              field: 'Tennis skill rating',
              value: 'Choose the person’s current rating from the provided scale.',
              effect:
                'Appears with the player in event and competition views where skill is displayed.',
            },
            {
              field: 'Date of birth and gender',
              value:
                'Both are required when inviting a member and when a member edits their profile.',
              effect:
                'Birth date contributes to family adult/child limits; gender affects eligibility for gender-specific events.',
            },
          ]}
        />
        <Steps>
          <li>Open Members and choose Invite member.</li>
          <li>Enter the required name, email, phone, skill rating, birth date, and gender.</li>
          <li>
            Send the invitation. The person must follow the email link to confirm and finish account
            setup.
          </li>
          <li>
            The invitation creates an approved member profile and a pending, unpaid membership; the
            recipient must still follow the email link to finish account setup and later complete
            membership payment and waiver steps.
          </li>
        </Steps>
        <p>
          If the email already belongs to an account, you will see a notification about it. Confirm
          the address with the requester and direct them to sign in rather than sending another
          invitation. Invitations are separate from the Applications queue, which is for people who
          applied through public account registration.
        </p>
      </Topic>
      <Topic id="admin-member-directory" title="Find and manage an approved member">
        <FieldTable
          rows={[
            {
              field: 'Search',
              value: 'Search by member name, email, or phone.',
              effect: 'Narrows the approved-member directory.',
            },
            {
              field: 'Role filter',
              value: 'Show all roles or only members, organizers, or admins.',
              effect: 'Helps find accounts with elevated portal access.',
            },
            {
              field: 'Membership type and paid status filters',
              value: 'Filter by Single, Family, Not assigned, Paid, or Unpaid.',
              effect:
                'Supports payment follow-up; verify the family-level payment before treating an individual family member as unpaid.',
            },
            {
              field: 'Role in Edit member',
              value: 'Set Member, Organizer, or Admin; admins cannot change their own role here.',
              effect:
                'Organizers manage their events; admins manage club-wide settings and members.',
            },
            {
              field: 'Administrator comment',
              value: 'Record internal follow-up context, not information intended for the member.',
              effect: 'Visible only to administrators.',
            },
            {
              field: 'Suspension dates and reason',
              value:
                'Enter a start date, end date, and reason; use the history to edit or remove an existing suspension.',
              effect: 'An active suspension prevents members from event registration.',
            },
          ]}
        />
        <p>
          Gender and tennis skill are profile information managed by the member. Gender affects
          eligibility for gender-specific events and categories; the skill rating is displayed with
          the player in event and competition views.
        </p>
        <p>
          <LinkButton href="/admin/members">Open Members</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-membership-plans" title="Set membership prices, family limits, and season">
        <FieldTable
          rows={[
            {
              field: 'Single full-season price',
              value: 'Enter the amount in Canadian dollars.',
              effect: 'Sets the price for a new individual membership checkout.',
            },
            {
              field: 'Family full-season price',
              value: 'Enter the shared family amount in Canadian dollars.',
              effect:
                'The family pays once for the confirmed household membership, subject to confirmation and waiver requirements.',
            },
            {
              field: 'Maximum adults and children',
              value: 'Set the permitted number in each group.',
              effect:
                'Limits count confirmed family members. Date of birth determines child/adult; without a birth date the account counts as an adult.',
            },
            {
              field: 'Season start and end month',
              value:
                'Choose the months; the season begins on the first day of the start month and ends on the last day of the end month.',
              effect:
                'Defines membership period dates and the annual membership context used across the app.',
            },
          ]}
        />
        <Callout>
          Changing prices or season settings affects only new checkouts and membership calculations.
        </Callout>
        <p>
          <LinkButton href="/admin/members?tab=membership-types">Open Membership types</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-family-flow" title="Understand family invitations, waivers, and payment">
        <p>
          Family membership is assembled by members from their Membership page; there is no separate
          admin control that silently adds people to a family. Each person must participate from
          their own approved account, and every waiver is individual.
        </p>
        <Steps>
          <li>
            A member starts a family by inviting another approved member, or an existing family
            member invites another eligible member.
          </li>
          <li>
            The invited person accepts the invitation from their account. Until acceptance, they are
            not a confirmed family member and family payment remains unavailable.
          </li>
          <li>
            Each confirmed person separately accepts the current membership waiver. Accepting a
            family invitation does not automatically accept a waiver.
          </li>
          <li>
            Once at least two family members are confirmed and every confirmed person has accepted
            the current waiver, an eligible family payment can start.
          </li>
          <li>
            Card payment is fulfilled after Stripe confirms success. Interac stays pending until an
            administrator reviews and confirms the received transfer.
          </li>
          <li>
            If the current waiver version changes, each family member must accept that version
            before the family is eligible for checkout.
          </li>
        </Steps>
        <p>
          The family membership can display as <strong>Pending</strong> before payment. A paid
          family should show as paid for its confirmed members.
        </p>
      </Topic>
    </div>
  );
}
