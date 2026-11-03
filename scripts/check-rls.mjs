import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(
  root,
  'supabase',
  'migrations',
  '20261103000000_current_database_state.sql',
);
const schema = await readFile(schemaPath, 'utf8');
const normalize = (name) => name.replaceAll('"', '').toLowerCase();
const createdTables = new Set(
  [...schema.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([\w"]+)/gi)].map(
    (match) => normalize(match[1]),
  ),
);
const rlsEnabledTables = new Set(
  [
    ...schema.matchAll(
      /alter\s+table\s+(?:only\s+)?public\.([\w"]+)\s+enable\s+row\s+level\s+security/gi,
    ),
  ].map((match) => normalize(match[1])),
);
const missing = [...createdTables].filter((table) => !rlsEnabledTables.has(table)).sort();

if (createdTables.size === 0) {
  console.error('RLS check failed: no public CREATE TABLE statements were detected.');
  process.exit(1);
}
if (missing.length > 0) {
  console.error(
    `RLS check failed: ${missing.length} public table(s) have no ENABLE ROW LEVEL SECURITY statement in the current-database baseline:`,
  );
  for (const table of missing) console.error(`- public.${table}`);
  process.exit(1);
}

console.log(
  `RLS static check passed: all ${createdTables.size} detected public tables have an ENABLE ROW LEVEL SECURITY statement.`,
);
console.log(
  'Note: this static check does not prove that RLS policies are correct or safe; review policies and run live authorization tests before deployment.',
);
