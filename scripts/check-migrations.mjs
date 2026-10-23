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
for (const name of incrementalFiles) {
  const sql = await readFile(path.join(incrementalDir, name), 'utf8');
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

if (process.exitCode) process.exit();
console.log(
  `Migration check passed: ${markers.length} ordered migrations in consolidated SQL; ${incrementalFiles.length} incremental migration file(s) checked.`,
);
