import { LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminDashboardGuide() {
  return (
    <>
      <Topic id="admin-dashboard" title="Use the club-wide dashboard">
        <p>
          The dashboard summarizes current membership, season events, attendance, and overdue
          membership records. It is a monitoring page; open the linked Admin Portal section to make
          a change or inspect an individual record.
        </p>
        <Steps>
          <li>
            <strong>Members.</strong> The total counts approved member accounts. Paid, Overdue, and
            Pending break down their membership payment state. A family’s shared payment is
            reflected for its confirmed members; an account awaiting membership approval is not
            counted as a member.
          </li>
          <li>
            <strong>Published events this season.</strong> The card uses the configured membership
            season dates. Upcoming and Past are based on event start time, so check the season
            configuration in Membership if the period does not match club policy.
          </li>
          <li>
            <strong>Attendance statistics by event type.</strong> Recurring sessions with the same
            title are grouped. Bars compare average registrations at cutoff with capacity; the
            tooltip includes vacant places, waitlisted entrants, and promotions. These are averages
            across sessions, not a count for one selected event.
          </li>
          <li>
            <strong>Overdue membership fees.</strong> Use this as a review queue, not an automatic
            collection notice. Open Membership and Payments to check the family or individual
            membership and payment history before contacting the member or changing anything.
          </li>
        </Steps>
        <p>
          <LinkButton href="/admin/dashboard">Open Admin dashboard</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-chat-notifications" title="Chat notification settings">
        <p>
          Chat push notifications are controlled by each member in their own profile and apply to
          individual devices. Administrators cannot enable push for another member or override their
          preference. The member’s existing Show all, mentions only, or Don’t show preference also
          controls push delivery. Push alerts are sent for new messages only; the sender is
          excluded.
        </p>
      </Topic>
    </>
  );
}
