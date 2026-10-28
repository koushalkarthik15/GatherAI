import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lockPath = join(root, 'package-lock.json');
const original = readFileSync(lockPath, 'utf8');
const previous = JSON.parse(original);
const temporary = mkdtempSync(join(tmpdir(), 'gather-lock-repair-'));
for (const file of ['package.json', 'apps/web/package.json', 'apps/api/package.json', 'packages/core/package.json']) {
	const target = join(temporary, file);
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(join(root, file), target);
}

console.log(`Generating a clean lockfile in ${temporary}`);
// Deliberately omit both the old lockfile and node_modules. An existing install
// can cause npm to retain only its own platform's optional native packages.
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
	'install', '--package-lock-only', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund',
], { cwd: temporary, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Lockfile generation failed; the repository lockfile was not changed.');

const candidatePath = join(temporary, 'package-lock.json');
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
for (const [parent, variants] of [
	['rollup', ['@rollup/rollup-linux-x64-gnu', '@rollup/rollup-linux-arm64-gnu', '@rollup/rollup-darwin-arm64', '@rollup/rollup-darwin-x64', '@rollup/rollup-win32-x64-msvc']],
	['esbuild', ['@esbuild/linux-x64', '@esbuild/linux-arm64', '@esbuild/darwin-arm64', '@esbuild/darwin-x64', '@esbuild/win32-x64']],
]) {
	const parentVersion = candidate.packages[`node_modules/${parent}`]?.version;
	if (!parentVersion) throw new Error(`Generated lockfile has no ${parent}.`);
	for (const name of variants) {
		const entry = candidate.packages[`node_modules/${name}`];
		if (entry?.version !== parentVersion || !entry.integrity || !entry.resolved) {
			throw new Error(`Generated lockfile is missing complete metadata for ${name}; original retained.`);
		}
	}
}

// A clean resolution can update versions within package.json ranges. Report
// them explicitly rather than presenting this as a native-metadata-only edit.
const changed = Object.entries(candidate.packages).filter(([path, entry]) => {
	const before = previous.packages[path];
	return before?.version && entry.version && before.version !== entry.version;
});
for (const [path, entry] of changed) {
	console.log(`${path}: ${previous.packages[path].version} -> ${entry.version}`);
}
console.log(`Resolved version changes: ${changed.length}`);
if (readFileSync(lockPath, 'utf8') !== original) {
	throw new Error('Repository lockfile changed during generation; refusing to overwrite it.');
}
const backup = join(temporary, 'package-lock.before-repair.json');
writeFileSync(backup, original);
if (!existsSync(candidatePath)) throw new Error('Generated lockfile disappeared.');
copyFileSync(candidatePath, lockPath);
console.log(`Repaired lockfile saved. Original backup: ${backup}`);
console.log('Next run npm ci, then the project checks. Cross-platform metadata is present; Linux execution still needs CI.');
