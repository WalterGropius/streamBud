// Spotify: reading song info from a Spotify link, and finding a song on Spotify.
//
// Reading needs no account: Spotify's public embed player page (the same page
// that powers the little Spotify players on blogs) lists the title, artists and
// artwork. If that ever fails we fall back to Spotify's official oEmbed
// endpoint, which only gives the title.
//
// Finding a song uses, in order:
//   1. Spotify's Web API, if you've added your own SPOTIFY_CLIENT_ID/SECRET
//      (since Feb 2026 Spotify only gives these to Premium accounts).
//   2. ListenBrainz (open, non-profit music database) to get candidate Spotify
//      IDs, each checked against Spotify's embed page before we trust it.
// If neither finds a confident match, the caller falls back to a search link.

import { ConvertError } from '../errors.js';
import { matchScore } from '../text.js';

export const USER_AGENT = 'streamBud/1.0 (+https://github.com/WalterGropius/streamBud)';
const TIMEOUT_MS = 8000;
const MATCH_THRESHOLD = 0.72;

function timeoutSignal(ms = TIMEOUT_MS) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

/** Read the JSON blob Spotify's embed page ships with. */
function parseEmbedPage(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity ?? null;
  } catch {
    return null;
  }
}

function bestImage(entity) {
  const images = [
    ...(entity?.visualIdentity?.image ?? []),
    ...(entity?.coverArt?.sources ?? []),
  ].filter((i) => i?.url);
  if (!images.length) return null;
  const size = (i) => i.maxWidth || i.width || 0;
  // Biggest image up to 640px; plenty for a 2x phone screen.
  images.sort((a, b) => size(b) - size(a));
  return (images.find((i) => size(i) <= 640) ?? images[images.length - 1]).url;
}

function entityToMeta(kind, id, entity) {
  const title = entity.name || entity.title || '';
  let artists = (entity.artists ?? []).map((a) => a?.name).filter(Boolean);
  if (!artists.length && kind === 'album' && entity.subtitle) artists = String(entity.subtitle).split(/,\s*/);
  return {
    kind,
    id,
    title,
    artists: kind === 'artist' ? [] : artists,
    durationMs: entity.duration || null,
    releaseDate: entity.releaseDate?.isoString ?? null,
    artwork: bestImage(entity),
    playable: entity.isPlayable !== false,
    url: `https://open.spotify.com/${kind}/${id}`,
  };
}

/** Song/album/artist info for a Spotify ID. */
export async function spotifyMetadata(kind, id, { fetch = globalThis.fetch } = {}) {
  let embedError = null;
  try {
    const res = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
      signal: timeoutSignal(),
    });
    if (res.status === 404) throw new ConvertError('NOT_FOUND', "Spotify doesn't know that link. Is it complete?", 404);
    if (res.ok) {
      const entity = parseEmbedPage(await res.text());
      if (entity && (entity.name || entity.title)) return entityToMeta(kind, id, entity);
    }
  } catch (err) {
    if (err instanceof ConvertError) throw err;
    embedError = err;
  }

  // Fallback: official oEmbed (title + artwork only).
  const res = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${kind}/${id}`)}`,
    { headers: { 'user-agent': USER_AGENT }, signal: timeoutSignal() },
  ).catch((err) => {
    throw new ConvertError('UPSTREAM', `Couldn't reach Spotify (${(embedError || err).message}).`, 502);
  });
  if (res.status === 404 || res.status === 400) {
    throw new ConvertError('NOT_FOUND', "Spotify doesn't know that link. Is it complete?", 404);
  }
  if (!res.ok) throw new ConvertError('UPSTREAM', `Spotify answered with an error (${res.status}).`, 502);
  const o = await res.json();
  return {
    kind,
    id,
    title: o.title || '',
    artists: [],
    durationMs: null,
    releaseDate: null,
    artwork: o.thumbnail_url || null,
    playable: true,
    url: `https://open.spotify.com/${kind}/${id}`,
  };
}

/** Follow a spotify.link / spoti.fi short link to the real open.spotify.com link. */
export async function resolveSpotifyShortLink(shortUrl, { fetch = globalThis.fetch } = {}) {
  const res = await fetch(shortUrl, {
    redirect: 'manual',
    headers: { 'user-agent': USER_AGENT },
    signal: timeoutSignal(),
  });
  const location = res.headers.get('location');
  if (location && /open\.spotify\.com/.test(location)) return location;
  if (res.ok) {
    const html = (await res.text()).slice(0, 200_000);
    const m = html.match(/https:\/\/open\.spotify\.com\/(?:track|album|artist|playlist|episode|show)\/[A-Za-z0-9]{22}/);
    if (m) return m[0];
  }
  throw new ConvertError('SHORT_LINK', "Couldn't open that Spotify short link. Try copying the full link instead.", 422);
}

// --- Spotify Web API (optional, needs your own credentials) ---------------

let tokenCache = { token: null, expires: 0 };

async function webApiToken(env, fetch) {
  if (tokenCache.token && Date.now() < tokenCache.expires - 60_000) return tokenCache.token;
  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: timeoutSignal(),
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

async function webApiSearch(want, kind, env, fetch) {
  const token = await webApiToken(env, fetch);
  const artist = want.artists?.[0] || '';
  const queries = [
    artist ? `${kind === 'album' ? 'album' : 'track'}:${want.title} artist:${artist}` : want.title,
    `${want.title} ${artist}`.trim(),
  ];
  for (const q of queries) {
    const url = `https://api.spotify.com/v1/search?type=${kind}&limit=5&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: timeoutSignal() });
    if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
    const data = await res.json();
    const items = data?.[`${kind}s`]?.items ?? [];
    const best = pickBest(
      want,
      items.filter(Boolean).map((it) => ({
        id: it.id,
        title: it.name,
        artists: (it.artists ?? []).map((a) => a.name),
        releaseDate: it.album?.release_date ?? it.release_date ?? null,
      })),
    );
    if (best) return best;
  }
  return null;
}

// --- ListenBrainz (open data, no key) --------------------------------------

async function listenBrainzCandidates(want, fetch) {
  const artists = (want.artists ?? []).filter(Boolean);
  if (!artists.length || !want.title) return [];
  // ListenBrainz matches on the full artist credit, so "Luis Fonsi, Daddy Yankee"
  // finds Despacito where "Luis Fonsi" alone doesn't. Try the full credit first.
  const credits = [...new Set([artists.join(', '), artists[0]])];
  // "Waka Waka (This Time for Africa)" is stored as "Waka Waka (This Time for Africa)"
  // on some services and "Waka Waka" on others; try both.
  const short = want.title.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  const titles = [...new Set([want.title, short].filter(Boolean))];
  const attempts = titles.flatMap((title) => credits.map((credit) => [credit, title]));
  for (const [credit, title] of attempts) {
    const url =
      'https://labs.api.listenbrainz.org/spotify-id-from-metadata/json' +
      `?artist_name=${encodeURIComponent(credit)}&release_name=&track_name=${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: timeoutSignal(6000) });
    if (!res.ok) continue;
    const data = await res.json();
    const ids = Array.isArray(data) ? data.flatMap((row) => row?.spotify_track_ids ?? []) : [];
    const valid = [...new Set(ids)].filter((id) => /^[A-Za-z0-9]{22}$/.test(id));
    if (valid.length) return valid.slice(0, 5);
  }
  return [];
}

async function verifiedFromIds(want, ids, fetch) {
  const metas = await Promise.allSettled(ids.map((id) => spotifyMetadata('track', id, { fetch })));
  const candidates = metas
    .filter((r) => r.status === 'fulfilled' && r.value.playable && r.value.artists.length)
    .map((r) => r.value);
  return pickBest(want, candidates);
}

/** Pick the best-scoring candidate; ties go to the earliest release (the original, not a compilation). */
export function pickBest(want, candidates, threshold = MATCH_THRESHOLD) {
  let best = null;
  for (const c of candidates) {
    const score = matchScore(want, c);
    if (score < threshold) continue;
    if (
      !best ||
      score > best.score + 0.05 ||
      (Math.abs(score - best.score) <= 0.05 && (c.releaseDate || '9999') < (best.releaseDate || '9999'))
    ) {
      best = { ...c, score };
    }
  }
  return best;
}

/**
 * Find a song (or album) on Spotify.
 * Returns { id, url, score, via } or null.
 */
export async function findOnSpotify(want, kind, { fetch = globalThis.fetch, env = {} } = {}) {
  if (!want?.title) return null;
  const notes = [];

  if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) {
    try {
      const hit = await webApiSearch(want, kind, env, fetch);
      if (hit) return { ...hit, url: `https://open.spotify.com/${kind}/${hit.id}`, via: 'spotify-api' };
    } catch (err) {
      notes.push(err.message);
    }
  }

  if (kind === 'track') {
    try {
      const ids = await listenBrainzCandidates(want, fetch);
      if (ids.length) {
        const hit = await verifiedFromIds(want, ids, fetch);
        if (hit) return { ...hit, url: `https://open.spotify.com/track/${hit.id}`, via: 'listenbrainz' };
      }
    } catch (err) {
      notes.push(err.message);
    }
  }

  if (notes.length) console.warn('[streamBud] Spotify lookup:', notes.join('; '));
  return null;
}
