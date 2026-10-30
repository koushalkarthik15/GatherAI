const MAX_RESPONSE_BYTES = 1024 * 1024;
const GEOCODE_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 12000;
export class DirectoryError extends Error {
	code: string;
	transient: boolean;
	constructor(code: string, transient = false) {
		super(code);
		this.code = code;
		this.transient = transient;
	}
}
export type Diagnostic = {
	event: 'directory_request';
	stage: 'geocode' | 'venues';
	code: string;
	durationMs: number;
	status?: number;
};
export function createDirectoryRequest(fetcher: typeof fetch, now: () => number) {
	return request;
	async function request(url: string, stage: Diagnostic['stage'], report: (value: Diagnostic) => void, body?: string): Promise<unknown> {
		const start = now();
		let response: Response;
		try {
			response = await fetcher(url, { method: body ? 'POST' : 'GET',
				headers: { 'User-Agent': 'GatherEventStudio/0.1 (explicit low-volume venue discovery)', 'Accept': 'application/json', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
				body, signal: AbortSignal.timeout(stage === 'geocode' ? GEOCODE_TIMEOUT_MS : SEARCH_TIMEOUT_MS), redirect: 'error' });
		}
		catch {
			report({ event: 'directory_request', stage, code: 'NETWORK_OR_TIMEOUT', durationMs: now() - start });
			throw new DirectoryError('DIRECTORY_UNAVAILABLE', stage === 'venues');
		}
		if (!response.ok) {
			report({ event: 'directory_request', stage, code: 'UPSTREAM_ERROR', status: response.status, durationMs: now() - start });
			void response.body?.cancel();
			throw new DirectoryError(response.status === 429 ? 'DIRECTORY_LIMIT' : 'DIRECTORY_UNAVAILABLE', stage === 'venues' && (response.status === 408 || response.status === 429 || response.status >= 500));
		}
		try {
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error();
			}
			let size = 0;
			const chunks: Uint8Array[] = [];
			for (;;) {
				const item = await reader.read();
				if (item.done) {
					break;
				}
				size += item.value.length;
				if (size > MAX_RESPONSE_BYTES) {
					await reader.cancel();
					throw new Error();
				}
				chunks.push(item.value);
			}
			const json: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			report({ event: 'directory_request', stage, code: 'OK', durationMs: now() - start });
			return json;
		}
		catch {
			report({ event: 'directory_request', stage, code: 'INVALID_RESPONSE', durationMs: now() - start });
			throw new DirectoryError('DIRECTORY_INVALID_RESPONSE');
		}
	}
}
