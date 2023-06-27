import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function call(url: string, init?: RequestInit): Promise<Response> {
	const request = new IncomingRequest(url, init);
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe('RefRed worker', () => {
	describe('missing / invalid Referer', () => {
		it('returns 400 when no Referer header is present', async () => {
			const response = await call('https://refred.to/foo');
			expect(response.status).toBe(400);
			expect(await response.text()).toBe('Referer header is missing or invalid');
		});

		it('returns 400 when the Referer is not a valid URL', async () => {
			const response = await call('https://refred.to/foo', {
				headers: { Referer: 'not a url' },
			});
			expect(response.status).toBe(400);
			expect(await response.text()).toBe('Invalid referer URL');
		});
	});

	describe('default behavior per referer host', () => {
		it('truncates a github.com referer to /owner/repo', async () => {
			const response = await call('https://refred.to/issues', {
				headers: { Referer: 'https://github.com/bilbilak/refred/blob/main/README.md' },
			});
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('https://github.com/bilbilak/refred/issues');
		});

		it('preserves the full referer pathname for non-forge hosts', async () => {
			const response = await call('https://refred.to/next', {
				headers: { Referer: 'https://example.com/a/b/c' },
			});
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('https://example.com/a/b/c/next');
		});
	});

	describe('?base= override', () => {
		it('base=root drops the referer path entirely', async () => {
			const response = await call('https://refred.to/issues?base=root', {
				headers: { Referer: 'https://github.com/bilbilak/refred/blob/main/README.md' },
			});
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('https://github.com/issues');
		});

		it('base=path keeps the full referer pathname', async () => {
			const response = await call('https://refred.to/next?base=path', {
				headers: { Referer: 'https://example.com/a/b/c' },
			});
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('https://example.com/a/b/c/next');
		});

		it('base=repo truncates to the first two path segments', async () => {
			const response = await call('https://refred.to/issues?base=repo', {
				headers: { Referer: 'https://codeberg.org/owner/repo/wiki/Home' },
			});
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('https://codeberg.org/owner/repo/issues');
		});

		it('rejects unknown base values with 400', async () => {
			const response = await call('https://refred.to/x?base=bogus', {
				headers: { Referer: 'https://github.com/foo/bar' },
			});
			expect(response.status).toBe(400);
			expect(await response.text()).toBe('Invalid base option');
		});
	});

	describe('response headers', () => {
		it('always sets X-Robots-Tag and CSP, even on error responses', async () => {
			const response = await call('https://refred.to/');
			expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive, nosnippet');
			expect(response.headers.get('Content-Security-Policy')).toMatch(/default-src 'self'/);
		});

		it('sets no-cache headers on redirects', async () => {
			const response = await call('https://refred.to/x', {
				headers: { Referer: 'https://github.com/foo/bar' },
			});
			expect(response.status).toBe(302);
			expect(response.headers.get('Cache-Control')).toMatch(/no-store/);
			expect(response.headers.get('Pragma')).toBe('no-cache');
		});
	});
});
