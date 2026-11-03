import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consolidatedPath = path.join(root, 'supabase', 'consolidated_migrations.sql');
const incrementalDir = path.join(root, 'supabase', 'migrations');

const fail = (message) => {
  console.error(`Migration check failed: ${message}`);
  process.exitCode = 1;
};

let consolidated;
try {
  consolidated = await readFile(consolidatedPath, 'utf8');
} catch {
  fail('supabase/consolidated_migrations.sql is missing.');
  process.exit();
}

const markerPattern = /^-- BEGIN MIGRATION: ([\w.-]+\.sql)$/gm;
const markers = [...consolidated.matchAll(markerPattern)].map((match) => ({
  name: match[1],
  index: match.index ?? 0,
}));
if (markers.length === 0) {
  fail('the consolidated SQL contains no migration boundary markers.');
  process.exit();
}

const numericPrefix = (name) => Number(name.match(/^(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
for (let index = 1; index < markers.length; index += 1) {
  if (numericPrefix(markers[index - 1].name) > numericPrefix(markers[index].name)) {
    fail(
      `migrations are out of order: ${markers[index - 1].name} appears before ${markers[index].name}.`,
    );
  }
}
if (new Set(markers.map((marker) => marker.name)).size !== markers.length) {
  fail('duplicate migration markers were found.');
}

let incrementalFiles = [];
try {
  incrementalFiles = (await readdir(incrementalDir)).filter((name) => name.endsWith('.sql'));
} catch {
  // Historical migrations are intentionally omitted from the distributable ZIP.
}
const archiveDir = path.join(root, 'supabase', 'migration_archive');
let archivedFiles = [];
try {
  archivedFiles = (await readdir(archiveDir)).filter((name) => name.endsWith('.sql'));
} catch {
  // The repository may use the normal incremental migration layout.
}

const isSquashedBaseline =
  incrementalFiles.length === 1 &&
  incrementalFiles[0] === '20261103000000_current_database_state.sql';
const historicalFiles = isSquashedBaseline ? archivedFiles : incrementalFiles;
for (const name of historicalFiles) {
  const sourceDir = isSquashedBaseline ? archiveDir : incrementalDir;
  const sql = await readFile(path.join(sourceDir, name), 'utf8');
  const markerIndex = consolidated.indexOf(`-- BEGIN MIGRATION: ${name}`);
  if (markerIndex < 0) {
    fail(`${name} is not represented in the consolidated SQL.`);
    continue;
  }
  const nextMarker = consolidated.indexOf('-- BEGIN MIGRATION:', markerIndex + 1);
  const section = consolidated.slice(markerIndex, nextMarker < 0 ? undefined : nextMarker);
  if (!section.includes(sql.trim()))
    fail(`${name} does not match its section in the consolidated SQL.`);
}

if (isSquashedBaseline) {
  const baseline = await readFile(path.join(incrementalDir, incrementalFiles[0]), 'utf8');
  const header =
    /^-- Squashed fresh-database migration, derived from the ordered historical migrations\.\r?\n-- For an empty local database only; existing databases must not replay this baseline\.\r?\n\r?\n/;
  const baselineBody = baseline.replace(header, '').trim();
  const firstMigration = consolidated.indexOf('-- BEGIN MIGRATION:');
  const expectedBody = consolidated
    .slice(firstMigration)
    .replace(/^-- BEGIN MIGRATION:.*\r?\n/gm, '')
    .replace(/^-- END MIGRATION:.*\r?\n/gm, '')
    .replace(/^(?:BEGIN|COMMIT);\s*$/gm, '')
    .replace(
      /^CREATE OR REPLACE VIEW public\.event_scoreboard AS$/gm,
      'DROP VIEW IF EXISTS public.event_scoreboard;\nCREATE VIEW public.event_scoreboard AS',
    )
    .trim();
  if (!header.test(baseline) || baselineBody !== expectedBody)
    fail('the squashed baseline does not match the normalized consolidated migration history.');
  if (archivedFiles.length !== markers.length)
    fail('the migration archive does not contain one file for every consolidated migration.');
}

if (process.exitCode) process.exit();
console.log(
  isSquashedBaseline
    ? `Migration check passed: one squashed baseline matches ${markers.length} ordered historical migrations.`
    : `Migration check passed: ${markers.length} ordered migrations in consolidated SQL; ${incrementalFiles.length} incremental migration file(s) checked.`,
);
