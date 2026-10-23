# PCTC code quality and verification

This project uses automated formatting, linting, TypeScript checks, unit tests, browser smoke tests, accessibility scans, database migration validation, and dependency auditing.

## Prerequisites

- Node.js 20 or newer (the current environment was Node 22 when this file was added).
- Install dependencies with `npm ci` when `package-lock.json` exists, otherwise `npm install`.
- Configure local environment variables from `.env.example` for application behavior that requires Supabase or Resend. Never commit `.env.local` or production secrets.
- For browser tests, install the Playwright browser once with `npx playwright install chromium`.

## Standard quality gate

Run the following before sharing a project ZIP. ESLint is configured with no warning threshold: warnings remain visible but do not fail lint; errors still fail lint. Next.js production builds keep lint enabled, and warnings alone are non-fatal.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run check:migrations
npm run check:rls
npm test
npm run build
```

Run the fuller checks when the environment is configured. The CI workflow also installs Chromium and runs browser tests; the server-rendered events-page smoke test is skipped unless Supabase or an external test target is configured.

```bash
npm run test:e2e
npm run test:a11y
npm run security:audit
```

`npm run quality` runs formatting, lint, TypeScript, migration, unit-test, and production-build checks. `npm run quality:full` also runs the Playwright suite. Security auditing is intentionally separate because it depends on registry access and can flag existing transitive dependencies that need review.

## What the tests cover

- Unit tests cover event URL helpers, news slug generation, phone formatting, ranking order, season boundaries, score-stat calculations, confirmation-dialog behavior, weather forecast selection and rendering, member selection/search behavior, the loading indicator, and Tailwind class merging.
- Playwright smoke tests verify that the public home and events pages respond.
- The axe-core test checks the home page for critical and serious automated WCAG violations.
- Authenticated member/admin journeys and database RLS integration tests require dedicated test users and a non-production Supabase project. They are not represented as verified by the public smoke tests.

## Supabase and database safety

- `supabase/consolidated_migrations.sql` is the one-file schema/history initializer for a fresh database.
- Any newly created incremental migration belongs in `supabase/migrations/` as its own numbered SQL file and must also be appended to the consolidated file in the same order.
- Do not re-run the consolidated initializer against a database that already has the schema. Existing deployments should apply only the new incremental migration(s).
- Run the migration check with `npm run check:migrations`.
- Run the static RLS coverage check with `npm run check:rls`. It verifies that each detected `public` table has an RLS-enable statement in the consolidated schema, but does not prove that policies enforce correct access.
- When the Supabase CLI and a local database are configured, additionally run `supabase db reset` against the disposable local project and `supabase db lint`. Never run reset against production.
- For database changes, manually verify RLS is enabled for tables containing user/member data, policies enforce both row visibility and write permissions, and privileged operations are enforced in database/server code rather than UI visibility alone.

## Security

- Keep service-role keys and Resend API keys server-side. Only browser-safe Supabase URL/anon-key values may use the `NEXT_PUBLIC_` prefix.
- Review `npm audit --audit-level=high` output; do not blindly apply breaking dependency updates.
- Review every diff before packaging. Do not remove or weaken a failing test solely to make checks green.
- Test authorization boundaries with a non-admin account and a separate test project before deploying permission changes.

## Reporting rules

For each delivery, report the actual result for Prettier, ESLint (error and warning counts), TypeScript, unit tests, migration validation, production build, Playwright, accessibility, and dependency audit. Mark checks as **not run** if dependencies, browsers, credentials, or network access are unavailable. Distinguish baseline issues from changes introduced by the iteration only when that distinction has been verified.
