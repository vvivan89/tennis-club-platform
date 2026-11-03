import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const archiveDir = path.join(root, 'supabase', 'migration_archive');
const baselineName = '20261103000000_current_database_state.sql';
const fail = (message) => {
  console.error(`Migration check failed: ${message}`);
  process.exitCode = 1;
};
const sqlFiles = async (directory) =>
  (await readdir(directory)).filter((name) => name.endsWith('.sql'));
const versionOf = (name) => name.match(/^(\d+)/)?.[1] ?? '';
const compareMigrations = (a, b) =>
  versionOf(a).localeCompare(versionOf(b), undefined, { numeric: true }) || a.localeCompare(b);

let migrations = [];
let archived = [];
try {
  [migrations, archived] = await Promise.all([sqlFiles(migrationDir), sqlFiles(archiveDir)]);
} catch {
  fail('supabase/migrations or supabase/migration_archive is missing.');
  process.exit();
}

if (!migrations.length) fail('supabase/migrations contains no SQL migrations.');
if (!archived.length) fail('supabase/migration_archive contains no historical SQL migrations.');

const orderedArchive = [...archived].sort(compareMigrations);
const archiveVersions = orderedArchive.map(versionOf);
if (new Set(archiveVersions).size !== archiveVersions.length)
  fail('duplicate migration versions were found in the historical archive.');
if (orderedArchive.some((name) => !versionOf(name)))
  fail('every historical migration filename must start with its numeric version.');

const hasBaseline = migrations.includes(baselineName);
const activeIncrementals = migrations
  .filter((name) => name !== baselineName)
  .sort(compareMigrations);
for (const name of activeIncrementals) {
  if (!archived.includes(name)) {
    fail(`${name} is missing from supabase/migration_archive.`);
    continue;
  }
  const [activeSql, archivedSql] = await Promise.all([
    readFile(path.join(migrationDir, name), 'utf8'),
    readFile(path.join(archiveDir, name), 'utf8'),
  ]);
  if (activeSql.trim() !== archivedSql.trim())
    fail(`${name} differs between supabase/migrations and supabase/migration_archive.`);
}

if (hasBaseline) {
  const baseline = await readFile(path.join(migrationDir, baselineName), 'utf8');
  const header =
    /^-- Squashed fresh-database migration, derived from the ordered historical migrations\.\r?\n-- For an empty local database only; existing databases must not replay this baseline\./;
  if (!header.test(baseline) || baseline.replace(header, '').trim().length === 0)
    fail('the squashed current-database baseline is missing its header or SQL body.');
}

if (process.exitCode) process.exit();
console.log(
  hasBaseline
    ? `Migration check passed: current-database baseline found; ${orderedArchive.length} historical migrations archived; ${activeIncrementals.length} incremental migration(s) verified.`
    : `Migration check passed: ${activeIncrementals.length} incremental migration(s) found; ${orderedArchive.length} historical migrations archived.`,
);
