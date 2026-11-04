import { FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminPaymentsGuide() {
  return (
    <div className="space-y-5">
      <Topic id="admin-payment-report" title="Read and export the payment report">
        <p>
          Report groups recorded transactions by year, purpose, and payment method. Use its filters
          to reconcile one period or type of payment, then export the matching rows to CSV. Stripe
          fees and net proceeds are shown when supplied by the processor; older records may not
          contain complete fee data.
        </p>
        <p>
          The report shows gross payments, refunds, Stripe fees, net proceeds or estimated receipts,
          monthly totals, and a breakdown by purpose. The Stripe and Interac transaction tabs have
          their own search, purpose, status, amount range, and date filters; those filters help
          locate a transaction but do not change its payment state.
        </p>
        <p>
          An export is a record of payment rows, not proof of a bank deposit. Match Interac
          transfers against the payer, amount, and reference before confirming them.
        </p>
      </Topic>
      <Topic id="admin-stripe-payment-flow" title="How Stripe card payments are processed">
        <Steps>
          <li>
            The member or event participant selects a payment option. The server checks the record,
            payer, current state, and amount, then creates or reuses an eligible payment attempt.
          </li>
          <li>
            The payer completes Stripe Checkout. Closing or cancelling Checkout does not mark the
            membership or event registration as paid.
          </li>
          <li>
            After Stripe reports success, the app verifies the Checkout Session/PaymentIntent and
            fulfills the linked membership or registration.
          </li>
          <li>
            If a payer reports a problem, find the row in Stripe payments and compare its provider
            status, purpose, record, amount, and timestamps before taking action.
          </li>
        </Steps>
        <p>
          Use the refund form only for a succeeded payment with refundable balance. Review the
          amount and reason before submitting; a partial refund leaves the remaining refundable
          balance available, while a full refund closes it. Stripe returns funds to the card through
          its own processing timeline.
        </p>
        <p>
          <a
            href="https://docs.stripe.com/checkout/fulfillment"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Read Stripe’s Checkout fulfillment documentation
          </a>
        </p>
      </Topic>
      <Topic id="admin-interac-settings" title="Configure Interac instructions">
        <FieldTable
          rows={[
            {
              field: 'Enable Interac payments',
              value: 'Turn on only after the receiving account and instructions are ready.',
              effect:
                'Shows Interac as an option for eligible signed-in membership and event payments.',
            },
            {
              field: 'Recipient email',
              value: 'Enter the club email address that receives transfers.',
              effect: 'Shown to the payer and included in the Interac instructions email.',
            },
            {
              field: 'Instructions',
              value: 'Explain auto-deposit and any transfer message the payer must include.',
              effect: 'Shown with the payment reference so the transfer can be matched.',
            },
            {
              field: 'Review note',
              value: 'A note is optional when confirming and required when rejecting a request.',
              effect:
                'Rejection records the reason; confirmation fulfills the linked membership or registration.',
            },
          ]}
        />
        <Steps>
          <li>
            Open Payments → Interac and verify the destination address and instructions before
            enabling requests.
          </li>
          <li>
            When a request appears, compare its payer, purpose, amount, and reference with the
            actual bank transfer.
          </li>
          <li>
            Confirm only after funds are received and matched. Reject an invalid or unreceived
            request with a clear reason.
          </li>
          <li>
            For a family membership or event team payment, check which linked members or
            registrations the amount covers before confirming.
          </li>
        </Steps>
        <p>
          Interac does not notify the app automatically when money arrives. Until you confirm the
          request, the payment and the linked membership or registration remain pending.
        </p>
      </Topic>
      <Topic id="admin-payment-refunds" title="Refunds and payment corrections">
        <p>
          Stripe refunds and Interac refunds are separate operations. Stripe refunds are initiated
          against the processor payment and must stay within its remaining refundable balance.
          Interac is a bank transfer, so the app records a manual refund after the club has returned
          the funds outside the app.
        </p>
        <Steps>
          <li>
            Open the transaction and verify the payer, linked record, payment method, amount, and
            current status.
          </li>
          <li>
            For Stripe, choose the refundable amount and enter the reason; verify the resulting
            refund state before closing the case.
          </li>
          <li>
            For Interac, return the funds through the club’s banking process, then use the
            manual-refund action to record what was returned.
          </li>
          <li>
            Reopen the member or event page to confirm the linked membership/registration state
            agrees with the payment record.
          </li>
        </Steps>
        <p>
          <LinkButton href="/admin/payments">Open Payments</LinkButton>
        </p>
      </Topic>
    </div>
  );
}
