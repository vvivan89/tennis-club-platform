import { FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';
import { ProfileFieldsTable } from '@/components/help-guides/profile-fields-table';

export function PublicHelpGuide({
  showNonMemberProfile = false,
}: {
  showNonMemberProfile?: boolean;
}) {
  return (
    <section id="public-guide" className="scroll-mt-24 space-y-4">
      <Topic id="visitor-account" title="Create an account without applying for membership">
        <p>
          Anyone can create a regular account. Creating an account gives you a profile; it does not
          submit a club membership application or grant access to member-only pages. You can apply
          for membership later from your profile.
        </p>
        <Steps>
          <li>
            Open <LinkButton href="/signup">Create an account</LinkButton> and enter your name,
            email, password, phone, date of birth, gender, and tennis skill rating.
          </li>
          <li>
            Follow the account confirmation email if Supabase asks you to confirm your address.
          </li>
          <li>
            Sign in and complete or update your profile. Your account remains a non-member account
            until you choose <strong>Apply for club membership</strong> and the club approves that
            application.
          </li>
        </Steps>
        <p>
          While your membership application is absent or under review, you can use your profile and
          public pages. Member-only portal pages remain unavailable until your application is
          approved.
        </p>
      </Topic>
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
              Open <LinkButton href="/events">Events</LinkButton> and select the event to see its
              complete description and registration controls.
            </li>
            <li>
              Sign in and complete the registration action while registration is open. Regular
              social event registrations require an approved account; some tournament pages allow
              public guest registration when the organizer enabled it.
            </li>
            <li>
              After registering, check the page for Registered, Waitlisted, payment status, and any
              partner or team details.
            </li>
            <li>
              Use the event page’s withdrawal action before its cutoff. If you registered a
              tournament as a team, the confirmation explains that both partners will be withdrawn
              together.
            </li>
          </Steps>
        </Topic>
      </div>
      <Topic
        id="visitor-tournament"
        title="Register for a public doubles tournament"
        intro="An organizer can enable public registration for a tournament. You can register with an existing non-member account or start with only an email address."
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
              field: 'Your personal details',
              value:
                'When signed in with a regular account, your name, email, phone, gender, and skill rating come from your profile. If you start without an account, the sign-in link lets you enter the required tournament details after you verify your email.',
              effect:
                'Profile details are used for your registration. An email-only entry creates event-only access so you can finish the registration and return to it later.',
            },
            {
              field: 'Phone, skill, and gender',
              value:
                'For a signed-in account, update these in your profile. In an email-only guest form, phone may be optional while skill rating and gender are required.',
              effect:
                'The skill rating appears with tournament participant/pair details when those details are displayed. Gender affects gender-specific and mixed-pair eligibility.',
            },
            {
              field: 'Partner',
              value:
                'Choose a registered member or enter a new partner’s details. Phone is optional; skill rating and gender are required for a new partner.',
              effect:
                'The partner must satisfy the same category rules. With both genders known, Mixed doubles requires one male and one female.',
            },
          ]}
        />
        <Steps>
          <li>
            If you already have an account, sign in first. If you do not, choose Register, enter
            your email, and follow the one-time sign-in link. The link returns you to the tournament
            so you can complete registration; an email-only guest can use My Events to return to
            their entries later. If the email belongs to an approved member, sign in as that member.
          </li>
          <li>
            Choose the event category and registration mode. Signed-in profile details are used
            automatically. For a partner entry, choose an existing member or enter the partner’s
            details; the invited partner may need to confirm before the team can pay.
          </li>
          <li>
            Review the entry and fee before submitting. Complete Stripe Checkout if payment is due;
            the entry is not treated as paid merely because you reached Stripe or returned to the
            site.
          </li>
        </Steps>
      </Topic>
      {showNonMemberProfile && (
        <Topic id="visitor-profile" title="Your profile as a non-member">
          <p>
            Your profile works like a member profile for personal and playing information, email
            preferences, and appearance settings. It does not provide access to member-only portal
            pages. The profile does not show the chat notification settings available to approved
            members.
          </p>
          <ProfileFieldsTable />
          <p>
            The profile also shows your membership application state. You can submit an optional
            comment with <strong>Apply for club membership</strong>; after submission, the status
            changes to under review. If an application is declined, you may apply again. Approval is
            required before member portal access is available.
          </p>
          <p>
            <LinkButton href="/profile">Open your profile</LinkButton>
          </p>
        </Topic>
      )}
    </section>
  );
}
