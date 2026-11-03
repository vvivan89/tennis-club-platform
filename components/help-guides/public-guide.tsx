import { FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function PublicHelpGuide() {
  return (
    <section id="public-guide" className="scroll-mt-24 space-y-4">
      <div className="max-w-3xl">
        <p className="eyebrow">For everyone</p>
        <h2 className="text-2xl font-semibold tracking-tight">Public and event visitors</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Public event pages show the published event information, registration window, cost,
          restrictions, and any tournament details the organizer has chosen to publish.
        </p>
      </div>
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
        intro="Some tournaments may allow registration without the member account."
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
              field: 'Your name and email',
              value: 'Required for a guest without an account.',
              effect:
                'They identify your provisional entry and let you receive event/payment correspondence.',
            },
            {
              field: 'Phone, skill, and gender',
              value: 'Phone, skill rating, and gender are optional for guest entries.',
              effect:
                'The skill rating appears with tournament participant/pair details when those details are displayed. Gender affects gender-specific and mixed-pair eligibility.',
            },
            {
              field: 'Partner',
              value:
                'Choose a registered member or enter a new partner’s name and email; phone, skill, and gender are optional fields where shown.',
              effect:
                'The partner must satisfy the same category rules. With both genders known, Mixed doubles requires one male and one female.',
            },
          ]}
        />
        <Steps>
          <li>
            Choose the event category and registration mode first. If you are signing in as an
            approved member, use the member search to select a partner; a guest enters the partner’s
            contact details.
          </li>
          <li>
            Review names, email, partner, category, and the price before submitting. For a paid
            guest registration the app creates a provisional entry, then asks you to complete Stripe
            Checkout.
          </li>
          <li>
            Finish checkout and wait for the return page to verify payment. The entry is not treated
            as paid merely because you reached Stripe or returned to the site.
          </li>
        </Steps>
      </Topic>
    </section>
  );
}
