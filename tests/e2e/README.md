# End-to-end test scope

Playwright tests are split between safe mocked browser tests and real-browser/database integration tests guarded by an explicit disposable-project sentinel. Mocked Auth tests never send email or write to Supabase. Integration tests are skipped unless the required `PCTC_E2E_*` values are explicitly provided.

## Commands

```bash
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:a11y
```

`pnpm test:e2e` starts the configured Next.js development server unless `PLAYWRIGHT_BASE_URL` points to an existing test server. Set `PLAYWRIGHT_BASE_URL` only to a local or disposable test deployment.

## Enabled browser coverage

- `auth-security.spec.ts`: browser signup validation and metadata submission, duplicate-email generic feedback, valid/invalid login requests, account-neutral password-reset request, signed-out member/admin route redirects, and narrow viewport control visibility. Auth endpoints are intercepted; this does not verify Supabase token issuance, email delivery, confirmation links, session persistence, or signout against a real provider.
- `member-profile.spec.ts`: profile edit/reload, phone and skill validation, avatar invalid/oversized/storage-failure feedback, member-to-admin route denial, and signout. It is skipped unless a dedicated member account, explicit disposable-project sentinel, and matching app/test Supabase URLs are set. The profile is snapshotted and restored after each test.
- `event-registration-integration.spec.ts`: signs two temporary approved members into real browser contexts, registers them for a free capacity-one event, verifies confirmed/waitlist states, withdraws the confirmed member, and checks database promotion plus audit records. It uses the service role only against an explicitly confirmed disposable project and cleans up all created rows/users in `finally`.
- `database-registration-invariants.spec.ts`: uses the service-role client only against an explicitly confirmed disposable Supabase database. It creates a capacity-16 event and 21 temporary users, races registration RPCs, checks capacity/waitlist uniqueness and audit entries, tests duplicates and simultaneous withdrawal/registration, and deletes its event, users, and audit rows in `finally`.
- `public-smoke.spec.ts`: public home and configured events route availability.
- `accessibility.spec.ts`: axe WCAG 2 A/AA and hydration-error checks for the homepage. The scan excludes only the Next.js development portal; run it against a production build to avoid dev-overlay artifacts.

## Requested scenario status

| Area                                         | Status                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and account security          | Browser-covered with intercepted signup/login/reset requests, generic duplicate/credential feedback, valid login routing, and signed-out protected-route redirects. Real confirmation/recovery email and session-expiry behavior is blocked on a dedicated auth/mail environment. |
| Profile                                      | Dedicated-account browser test covers persistence, supported rating selection, phone formatting, avatar file validation, and storage failure. Cross-user RLS/profile mutation needs the disposable DB and a second member account.                                                |
| Event discovery and registration             | Public event listing/navigation is browser-smoke covered. Free registration, waitlist, withdrawal, promotion, persisted state, and related audit rows are covered by gated browser/database integration. Duplicate RPC attempts are covered by the database invariant test.       |
| Capacity, concurrency, and waitlists         | Gated real database test races 20 requests against capacity 16, verifies no over-capacity/duplicate users, unique queue positions, duplicate rejection, and concurrent withdrawal/new registration. It is skipped without the explicit disposable database guard.                 |
| Event administration and court assignments   | Unit/component tests cover create/edit, admin participant add/remove/replace, assignment validation/save, score entry/edit, and role guards. Full browser/admin persisted-state journeys require a dedicated admin account and seeded test DB.                                    |
| Rankings, statistics, and tournament results | Ranking and score calculation unit tests exist. Full tournament creation/result/ranking browser workflows are not verified; tournaments have no separate end-to-end results-management journey in this suite.                                                                     |
| Notifications and email                      | Unit tests cover queue dispatch, preferences, escaped content, provider errors, reminder logging, and family invitation mail. Browser delivery to a test mail inbox is blocked until a dedicated test sender/provider is configured.                                              |
| Audit logging                                | UI formatting/search/filter/details tests and real DB registration audit assertions cover representative actions and exactly-once business entries. Full RLS actor separation and assignment audit persistence require the gated DB project.                                      |
| Resilience, navigation, and accessibility    | Browser tests cover auth/profile failures, public navigation, mobile nav visibility, home-page axe checks, and hydration errors. Offline/interrupted requests and cross-browser visual screenshots are not yet covered.                                                           |
| Payments and refunds                         | Unsupported in the current event flow: no complete checkout, webhook, refund, or waitlist-charge workflow is implemented. No payment behavior is simulated as working.                                                                                                            |

This matrix intentionally separates browser assertions from unit mocks and real-database checks; a mocked API response is not evidence of RLS, transaction, payment, or persistence correctness.

## Dedicated database setup

Never point these tests at production or a shared club database. Provision a disposable Supabase project with the consolidated schema, then set a dedicated member account and service credentials in the shell or CI secret store. The profile test also requires `.env.local`'s public Supabase URL to equal the E2E URL, so the app and fixture cannot silently target different projects.

Required variables for database-backed registration tests:

```text
PCTC_E2E_SUPABASE_URL
PCTC_E2E_SUPABASE_ANON_KEY
PCTC_E2E_SUPABASE_SERVICE_ROLE_KEY
PCTC_E2E_DISPOSABLE_DATABASE=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION
```

Additional variables for profile/signout integration:

```text
PCTC_E2E_MEMBER_EMAIL
PCTC_E2E_MEMBER_PASSWORD
NEXT_PUBLIC_SUPABASE_URL=<same value as PCTC_E2E_SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key for that same project>
```

Run gated suites explicitly after verifying the project URL:

```bash
pnpm exec playwright test tests/e2e/database-registration-invariants.spec.ts
pnpm exec playwright test tests/e2e/event-registration-integration.spec.ts
pnpm exec playwright test tests/e2e/member-profile.spec.ts
```

The concurrency test exercises the real database RPC and checks the capacity invariant; the event journey verifies the browser and database state together. This workspace has no local Supabase CLI/Docker runtime and no `PCTC_E2E_*` credentials, so database/profile integration cases are currently skipped here, not verified.

## Unsupported or blocked workflows

These flows are not represented as passing E2E behavior because the current app does not expose the relevant production workflow, or the required isolated provider/database is unavailable:

- Payment checkout, payment webhooks, refunds, and charging waitlisted participants: no complete event payment checkout/webhook workflow is present. The database test uses free events; it does not invent payment/consent rules.
- Real email confirmation, password-recovery link expiry, and email delivery: use a dedicated test mail provider and disposable auth project; current browser auth tests mock endpoints.
- True cross-browser refresh-token expiration, RLS isolation between distinct accounts, and live storage authorization: require the dedicated Supabase project and accounts.
- Court assignment transaction/audit-log exactly-once behavior, tournament creation/results/rankings end-to-end, and admin applications/approval end-to-end: component/unit coverage exists, but these are not yet exercised as browser-plus-database workflows.
- Visual screenshot regression baselines: not configured; current Playwright checks include responsive login visibility and axe accessibility, not screenshot snapshots.
- Payment-aware event registration, payment refunds, concurrent waitlist promotion retries, and webhook idempotency: blocked until checkout/webhook business rules and a dedicated payment-provider test mode are provisioned.

Unit tests cover many UI/API branches, but they do not substitute for the listed real-database, RLS, email, payment, or browser persistence checks.
