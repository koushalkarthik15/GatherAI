import assert from 'node:assert/strict';
import test from 'node:test';
import { createDirectoryRequest, DirectoryError, type Diagnostic } from '../src/sourcing/client.ts';

// These fixtures make no network requests and must not log the upstream URL/key.
test('directory client rejects oversized responses without exposing credentials', async () => {
	const diagnostics: Diagnostic[] = [];
	const request = createDirectoryRequest(async () => new Response('x'.repeat(1024 * 1024 + 1)), () => 100);
	await assert.rejects(
		request('https://example.test/?apiKey=private-fixture', 'venues', value => diagnostics.push(value)),
		(error: unknown) => error instanceof DirectoryError && error.code === 'DIRECTORY_INVALID_RESPONSE',
	);
	assert.equal(diagnostics.at(-1)?.code, 'INVALID_RESPONSE');
	assert.equal(JSON.stringify(diagnostics).includes('private-fixture'), false);
});

test('directory client distinguishes retryable provider failures from bad requests', async () => {
	for (const [status, transient, code] of [[429, true, 'DIRECTORY_LIMIT'], [503, true, 'DIRECTORY_UNAVAILABLE'], [400, false, 'DIRECTORY_UNAVAILABLE']] as const) {
		const request = createDirectoryRequest(async () => new Response('', { status }), Date.now);
		await assert.rejects(
			request('https://example.test/', 'venues', () => {}),
			(error: unknown) => error instanceof DirectoryError && error.transient === transient && error.code === code,
		);
	}
});
