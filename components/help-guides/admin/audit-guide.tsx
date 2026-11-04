import { Callout, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminAuditGuide() {
  return (
    <Topic id="admin-audit-logs" title="Use Audit Logs to understand what happened">
      <p>
        Audit Logs are important because club administration changes affect real people’s access,
        payments, registrations, and competition records. When a member reports an unexpected status
        or an event changes in a way no one remembers making, the log gives administrators a
        chronological record to investigate instead of relying on recollection or making a second
        change that could hide the original problem.
      </p>
      <p>
        Use the audit records to identify who or what initiated an action, when it happened, which
        record was affected, whether it succeeded, and—in supported entries—what changed. The
        Application errors view is different: it helps diagnose failed requests and operational
        issues rather than documenting a successful business change.
      </p>
      <Steps>
        <li>
          Choose Audit records for business changes or Application errors for failed operations.
        </li>
        <li>
          Filter by date range, source, and, for audit rows, action or outcome. Search summaries,
          routes, record IDs, and related terms to narrow the results.
        </li>
        <li>
          Open a matching row and inspect its details and change values. Use the event, member, or
          payment page to verify the current live record.
        </li>
        <li>
          Use the timestamp, actor, event, and correlation information when reporting a suspected
          issue to the club’s technical support.
        </li>
      </Steps>
      <section
        aria-labelledby="application-errors-guide"
        className="space-y-3 border-t border-border pt-5"
      >
        <h3 id="application-errors-guide" className="text-lg font-semibold">
          Application errors: tracing and fixing bugs
        </h3>
        <p>
          Application errors records failed requests and operational problems. Each row can show
          when the failure happened, its severity, source, error type, message, route, operation,
          related event, correlation ID, and technical details. These records are diagnostic clues;
          they do not necessarily include a full code stack trace.
        </p>
        <Steps>
          <li>
            Ask what action failed and approximately when. Filter Application errors by date,
            severity, source, route, or search terms from the message and operation.
          </li>
          <li>
            Open Details and capture the error type, message, route, operation, related event, and
            correlation ID. Share these details with the app developer along with the steps that
            caused the failure; avoid sending passwords, card data, or other secrets.
          </li>
          <li>
            The developer uses the route and operation to locate the relevant request handler, then
            uses the timestamp and correlation ID to connect this record with related application or
            database logs. Technical details may reveal the failing input or dependency.
          </li>
          <li>
            The developer reproduces the problem in a safe environment, identifies the cause,
            implements and verifies a fix, and deploys it. After deployment, repeat the original
            workflow and check whether new errors continue to appear.
          </li>
        </Steps>
      </section>
      <Callout>
        Logs are read-only evidence, not a way to reverse a change. They may not contain every
        detail of every operation. Correct the live record through its normal admin workflow, and
        use a refund or event correction process where appropriate.
      </Callout>
      <p>
        <LinkButton href="/admin/audit-logs">Open Audit Logs</LinkButton>
      </p>
    </Topic>
  );
}
