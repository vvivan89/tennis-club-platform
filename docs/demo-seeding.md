# Demo data seeding

The demo seed script reads credentials from environment variables; do not put service-role keys or passwords directly in the script.

Required variables:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`: URL for the target Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: server-side service-role/secret key for that same project. Never expose this key in browser code or commit it.
- `PCTC_DEMO_PASSWORD`: password assigned to the generated demo accounts.

Put these entries in the project-root `.env.local` file (or `.env`):

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
PCTC_DEMO_PASSWORD=choose-a-demo-password
```

The script loads `.env` and then `.env.local`; variables already exported in the shell take precedence over both files. Keep `.env.local` out of version control.

Run from the project root:

```bash
pnpm seed:demo
```

The seeder only creates scores for past events whose start times are within the database's two-day score-entry window. The database trigger remains enabled.
