import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Use only a disposable database with GatherAI migrations and a confirmed test account.
// Libpq reads the URL from its environment rather than from process arguments.
const databaseUrl = process.env.GATHER_TEST_DATABASE_URL;
if (!databaseUrl) {
 console.error('Set GATHER_TEST_DATABASE_URL to a disposable test database with migrations and a confirmed test account.');
 process.exit(1);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const file of ['initial_generation.sql', 'initial_generation_quota.sql', 'reviewed_proposals.sql', 'directory_gate.sql']) {
 console.log(`Running ${file} (transaction rolls back).`);
 const result = spawnSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', join(root, 'supabase', 'tests', file)], {
  stdio: 'inherit', env: { ...process.env, PGDATABASE: databaseUrl },
 });
 if (result.error) {
  console.error('Could not start psql. Install PostgreSQL client tools and retry.');
  process.exit(1);
 }
 if (result.status !== 0) process.exit(result.status ?? 1);
}
