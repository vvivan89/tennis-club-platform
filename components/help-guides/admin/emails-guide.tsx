'use client';

import { FieldTable, Topic } from '@/components/help-guide-primitives';
import { useSiteHeaderState } from '@/components/site-header-state';

function Token({ children }: { children: string }) {
  return (
    <em className="rounded bg-muted px-1 not-italic text-muted-foreground">{`{${children}}`}</em>
  );
}

function EmailPreview({ subject, children }: { subject?: string; children: React.ReactNode }) {
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      {subject && (
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Subject
          </p>
          <p className="mt-1 font-semibold">{subject}</p>
        </div>
      )}
      <div className="space-y-4 px-4 py-5 text-sm leading-6">{children}</div>
    </article>
  );
}

function EmailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-5">
      <h4 className="text-lg font-semibold">{title}</h4>
      {children}
    </section>
  );
}

export function AdminEmailsGuide() {
  const { shortName } = useSiteHeaderState();
  const brand = shortName || 'Club';
  return (
    <Topic id="admin-emails" title="Emails">
      <p>
        This guide documents when the app sends email and previews the messages using their actual
        HTML layout. Braced values are filled in when the message is sent. The subjects and wording
        are based on the current <code>EMAILS.md</code> inventory.
      </p>
      <p>
        Routine messages controlled by member email preferences include a category-specific
        unsubscribe link. Recipients confirm on the linked page without signing in. Account,
        security, and required transaction messages do not include that link.
      </p>

      <EmailSection title="Event registration and event updates">
        <p>
          Queued event notices use the same layout. The notification type determines the subject and
          first paragraph; recurring events include their schedule.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Confirmed registration',
              value: 'Registration is created with confirmed status.',
              effect: `${brand} — Registration confirmed: {event title} — Your registration has been recorded. Your current registration status is shown below.`,
            },
            {
              field: 'Waitlisted registration',
              value: 'Registration is created with waitlisted status.',
              effect: `${brand} — You're on the waitlist: {event title} — Your registration has been recorded. Your current registration status is shown below.`,
            },
            {
              field: 'Other registration status',
              value: 'A registration is created with another status.',
              effect: `${brand} event registration — Your registration has been recorded. Your current registration status is shown below.`,
            },
            {
              field: 'Registration cancelled',
              value: 'A member’s event registration is cancelled.',
              effect: `${brand} event registration was cancelled — Your event registration has been cancelled.`,
            },
            {
              field: 'Event cancelled',
              value: 'An event a member registered for is cancelled by the club.',
              effect: `${brand} event cancelled — An event you registered for has been cancelled by the club.`,
            },
            {
              field: 'Waitlist promotion',
              value: 'A waitlisted registration is promoted to confirmed.',
              effect: `Your place in a ${brand} event is confirmed — A place has opened and you have been moved from the waitlist to confirmed.`,
            },
            {
              field: 'New event',
              value: 'A published event is made available for registration.',
              effect: `New ${brand} event announced — A new club event is available for registration.`,
            },
          ]}
        />
        <EmailPreview subject={`${brand} — Registration confirmed: {event title}`}>
          <p>
            Hello <Token>member name or “member”</Token>,
          </p>
          <p>
            Your registration has been recorded. Your current registration status is shown below.
          </p>
          <h5 className="text-lg font-semibold">
            <Token>event title</Token>
          </h5>
          <p>
            <strong>Next session:</strong> <Token>event date and time</Token> ·{' '}
            <Token>location, when present</Token>
          </p>
          <p>
            <strong>Registration status:</strong> Your registration is confirmed.
          </p>
          <p>
            <a className="font-medium text-primary underline" href="#">
              View event details
            </a>
          </p>
          <p>{brand}</p>
        </EmailPreview>
        <p>
          Waitlisted registrations say “You are on the waitlist” and include a queue position when
          known. A recurring event’s date label is “Next session”; its schedule is “Every weekday”,
          “Every other weekday”, or “Monthly on the ordinal weekday”.
        </p>
      </EmailSection>

      <EmailSection title="Registration opening reminder">
        <p>
          Sent when registration opens to members with registration reminders enabled, except those
          already registered or previously reminded for that event.
        </p>
        <EmailPreview subject="Registration is open: {event title}">
          <p>
            Hello <Token>member name or “member”</Token>,
          </p>
          <p>
            Registration is now open for{' '}
            <strong>
              <Token>event title</Token>
            </strong>
            .
          </p>
          <p>
            <Token>event date and time</Token> · <Token>event location</Token>
          </p>
          <p>
            <a className="font-medium text-primary underline" href="#">
              View event and register
            </a>
          </p>
        </EmailPreview>
      </EmailSection>

      <EmailSection title="Pending event payment reminders">
        <p>
          Sent to confirmed registrants who still need to pay, approximately 24 hours and one hour
          before the registration cutoff. The registration reminder preference is honored.
        </p>
        {(['about 24 hours', 'about one hour'] as const).map((remaining, index) => (
          <EmailPreview
            key={remaining}
            subject={
              index === 0
                ? 'Payment required to keep your place: {event title}'
                : 'Final reminder: event payment due soon — {event title}'
            }
          >
            <p>
              Hello <Token>member name or “member”</Token>,
            </p>
            <p>
              Your registration for{' '}
              <strong>
                <Token>event title</Token>
              </strong>{' '}
              is awaiting payment. The registration cutoff is <Token>cutoff date and time</Token>{' '}
              (Pacific time), in {remaining}.
            </p>
            <p>
              If payment is not confirmed by the cutoff, your registration will be removed and your
              place may be given to another member.
            </p>
            <p>
              <a className="font-medium text-primary underline" href="#">
                Complete or check your event payment
              </a>
            </p>
            <p>Port Coquitlam Tennis Club</p>
          </EmailPreview>
        ))}
      </EmailSection>

      <EmailSection title="Tournament partner confirmation invitation">
        <p>
          Sent to an invited partner who has an account. An event-only guest partner instead
          receives a Supabase Auth sign-in link.
        </p>
        <EmailPreview subject="Confirm your place with {inviting player's name}">
          <p>
            Hello <Token>invited player’s name</Token>,
          </p>
          <p>
            <Token>inviting player’s name</Token> has listed you as a partner for{' '}
            <strong>
              <Token>event title or “this event”</Token>
            </strong>
            . Sign in to review the entry details and confirm your participation.
          </p>
          <p>
            <a className="font-medium text-primary underline" href="#">
              Review and confirm your event entry
            </a>
          </p>
          <p>If you do not recognize this invitation, you can ignore this email.</p>
          <p>{brand}</p>
        </EmailPreview>
      </EmailSection>

      <EmailSection title="League event registration confirmation">
        <p>
          Sent to both teammates after either teammate registers their fixed team for a later event,
          and after an invited player confirms participation. Each recipient’s registration-update
          preference is honored.
        </p>
        <EmailPreview subject="Registration confirmed: {event title}">
          <p>
            Hello <Token>player’s name or “player”</Token>,
          </p>
          <p>
            Your registration has been recorded. Your current registration status is shown below.
          </p>
          <h5 className="text-lg font-semibold">
            <Token>event title or “League event”</Token>
          </h5>
          <p>
            <strong>Date:</strong> <Token>event date and time</Token> ·{' '}
            <Token>event location, when present</Token>
          </p>
          <p>
            <strong>Registration status:</strong> Your registration is confirmed.
          </p>
          <p>
            <a className="font-medium text-primary underline" href="#">
              View event details
            </a>
          </p>
          <p>Port Coquitlam Tennis Club</p>
        </EmailPreview>
      </EmailSection>

      <EmailSection title="Membership renewal reminders">
        <p>
          Sent about seven days before a season begins or seven days after it begins. Paid members
          and members covered by a paid family membership are excluded.
        </p>
        <EmailPreview subject={`${brand} membership renewal is coming up`}>
          <p>
            Hello <Token>member name or “member”</Token>,
          </p>
          <p>
            The {brand} membership season begins on <Token>season start date, YYYY-MM-DD</Token>.
            Please renew your membership before the season starts.
          </p>
          <p>
            <a className="font-medium text-primary underline" href="#">
              View your member portal
            </a>
          </p>
        </EmailPreview>
        <EmailPreview subject={`${brand} membership fee reminder`}>
          <p>
            Hello <Token>member name or “member”</Token>,
          </p>
          <p>
            The {brand} membership season began on <Token>season start date, YYYY-MM-DD</Token> and
            we have not recorded a payment for you. Please renew your membership.
          </p>
          <p>
            <a className="font-medium text-primary underline" href="#">
              View your member portal
            </a>
          </p>
        </EmailPreview>
      </EmailSection>

      <EmailSection title="Family membership invitation">
        <p>Sent when a member invites another member to join a family membership.</p>
        <EmailPreview subject={`${brand} family membership invitation`}>
          <p>
            Hello <Token>invited member’s name or “member”</Token>,
          </p>
          <p>
            <Token>inviting member’s name, email, or “A member”</Token> invited you to join their
            {brand} family membership.
          </p>
          <p>
            Sign in to your Member Portal and confirm the invitation:{' '}
            <a className="font-medium text-primary underline" href="#">
              Review invitation
            </a>
            .
          </p>
        </EmailPreview>
      </EmailSection>

      <EmailSection title="Interac instructions and review outcomes">
        <p>
          The instructions email is sent once when a request is created. The other messages follow
          administrator review.
        </p>
        <EmailPreview subject={`${brand} Interac payment instructions`}>
          <p>Your {brand} Interac payment request is pending.</p>
          <dl className="grid gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-[auto_1fr]">
            <dt className="font-medium">Amount</dt>
            <dd>
              <Token>amount with two decimals</Token> CAD
            </dd>
            <dt className="font-medium">Send to</dt>
            <dd>
              <Token>club Interac recipient email</Token>
            </dd>
            <dt className="font-medium">Payment reference</dt>
            <dd>
              <Token>payment ID</Token>
            </dd>
          </dl>
          <p>
            <Token>Interac instructions configured by the club</Token>
          </p>
          <p>
            Your membership or event registration will be finalized after the club confirms receipt.
          </p>
        </EmailPreview>
        <EmailPreview subject={`${brand} Interac payment confirmed`}>
          <p>
            Hello <Token>member name or “member”</Token>,
          </p>
          <p>
            The club has confirmed your Interac payment of <Token>amount</Token>{' '}
            <Token>currency</Token>. Your associated membership or event registration has been
            updated.
          </p>
          <p>
            Payment reference: <Token>payment ID</Token>
          </p>
        </EmailPreview>
        <EmailPreview subject={`${brand} Interac payment requires attention`}>
          <p>
            Hello <Token>member name or “member”</Token>,
          </p>
          <p>
            The club could not confirm your Interac payment request. Reason:{' '}
            <Token>administrator’s note or “Please contact the club.”</Token>
          </p>
          <p>
            Payment reference: <Token>payment ID</Token>
          </p>
        </EmailPreview>
      </EmailSection>

      <EmailSection title="Membership application approved">
        <p>
          Sent after an administrator approves an application, when Resend is configured and the
          applicant has an email address.
        </p>
        <EmailPreview subject={`Your ${brand} application has been approved`}>
          <p>
            Hello <Token>applicant’s name</Token>,
          </p>
          <p>
            Your {brand} account has been approved. You can now sign in and access member features.
          </p>
          <p>
            <a className="font-medium text-primary underline" href="#">
              Sign in to {brand}
            </a>
          </p>
        </EmailPreview>
      </EmailSection>

      <EmailSection title="Administrator announcements">
        <p>
          Administrators initiate these messages by choosing a recipient group and entering the
          subject and sanitized HTML body. Broad audiences ignore profile preferences; Newsletter
          subscribers respect the newsletter preference and receive a newsletter unsubscribe link.
        </p>
        <EmailPreview subject="{administrator-entered subject}">
          <p>
            Hello <Token>recipient’s name or “member”</Token>,
          </p>
          <p>
            <Token>administrator-authored message body</Token>
          </p>
          <p>Port Coquitlam Tennis Club</p>
        </EmailPreview>
      </EmailSection>
    </Topic>
  );
}
