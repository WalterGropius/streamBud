// Turns an /api/convert request into a response. Shared by the Vercel
// function (api/convert.js) and the local server (server.js).

import { convert, ConvertError } from './convert.js';

const MAX_INPUT = 2000;

/**
 * @param {URLSearchParams} params  expects ?url=<link or text>
 * @returns {Promise<{ status: number, headers: Record<string,string>, body: object }>}
 */
export async function handleConvert(params, { fetch = globalThis.fetch, env = {} } = {}) {
  const input = params.get('url') ?? params.get('text') ?? params.get('q') ?? '';
  const json = { 'content-type': 'application/json; charset=utf-8' };

  if (!input.trim() || input.length > MAX_INPUT) {
    return {
      status: 400,
      headers: { ...json, 'cache-control': 'no-store' },
      body: { error: { code: 'NO_LINK', message: 'Paste a Spotify or YouTube Music link.' } },
    };
  }

  try {
    const result = await convert(input, { fetch, env });
    return {
      status: 200,
      headers: {
        ...json,
        // Songs don't move, so let the CDN keep answers for a day.
        'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
      },
      body: result,
    };
  } catch (err) {
    const known = err instanceof ConvertError;
    if (!known) console.error('[streamBud] convert failed:', err);
    const status = known ? err.status : 500;
    return {
      status,
      headers: { ...json, 'cache-control': status < 500 ? 'public, s-maxage=300' : 'no-store' },
      body: {
        error: {
          code: known ? err.code : 'INTERNAL',
          message: known ? err.message : 'Something went wrong on our side. Try again in a moment.',
        },
      },
    };
  }
}
