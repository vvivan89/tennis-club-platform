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
          If the birthdate shows you are under 18, add at least one parent or legal guardian with a
          name and either an email address or phone number. You may add more than one guardian.
          Adults do not see these fields. Guardian contact details are kept private and are not
          displayed on public player listings.
        </p>
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
        title="Register for a public tournament"
        intro="An organizer can enable public registration for a tournament. You can register with an existing non-member account or start with only an email address."
      >
        <FieldTable
          rows={[
            {
              field: 'Category',
              value: 'Choose one of the enabled tournament categories.',
              effect:
                'Singles categories are All gender, Men’s singles, and Women’s singles. You may enter up to two eligible Singles categories, but not both Men’s and Women’s singles. Doubles categories may be Mixed, Men’s, or Women’s. Category capacity may apply; your gender is checked, and Doubles partner gender is checked too.',
            },
            {
              field: 'Registration type',
              value:
                'Singles entries are individual. For Doubles, if both modes are enabled, choose to register individually or as a pair.',
              effect:
                'Individual Doubles entries can be paired by the organizer. Doubles pair registration automatically registers the partner and reserves your team. Singles has no partner registration.',
            },
            {
              field: 'Your personal details',
              value:
                'When signed in with a regular account, your name, email, phone, gender, and skill rating come from your profile. If you start without an account, the sign-in link lets you enter the required tournament details after you verify your email.',
              effect:
                'Profile details are used for your registration. An email-only entry creates event-only access so you can finish the registration and return to it later.',
            },
            {
              field: 'Date of birth and guardian contacts',
              value:
                'An email-only player must enter their date of birth. A player under 18 must provide at least one parent/legal guardian name and an email address or phone number; additional guardians can be added.',
              effect:
                'Guardian fields appear only for players under 18. Guardian contacts are private and are not shown on public tournament participant listings.',
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
            {
              field: 'Tennis skill restriction',
              value:
                'If shown, the organizer has set a minimum and/or maximum player rating for this tournament.',
              effect:
                'Your profile rating must be within the displayed inclusive range. Singles registrations need a profile rating; for Doubles, both players must qualify.',
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
            Choose the event category and registration mode. Singles uses individual registration;
            for Doubles, choose an existing member or enter the partner’s details for a pair entry.
            Signed-in profile details are used automatically. An invited Doubles partner may need to
            confirm before the team can pay.
          </li>
          <li>
            Review the entry and fee before submitting. Complete Stripe Checkout if payment is due;
            the entry is not treated as paid merely because you reached Stripe or returned to the
            site.
          </li>
        </Steps>
        <p>
          If the organizer configured discounts, the tournament page describes the available rules.
          Discounts may depend on approved membership, a Doubles pair entry, or a second category in
          Singles or Doubles. After registration, each entry shows its base fee, discount, and
          amount due. A pair payment totals both participants’ amounts.
        </p>
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
