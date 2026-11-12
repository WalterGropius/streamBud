// YouTube / YouTube Music: reading song info from a link, and finding a song.
//
// Reading needs no key: YouTube's official oEmbed endpoint gives the video
// title and channel name, which we clean up into "artist + song".
// With a (free) YOUTUBE_API_KEY we use the YouTube Data API instead, which is
// more precise for YouTube Music tracks ("Provided to YouTube by ...").
//
// Finding a song needs the YOUTUBE_API_KEY (YouTube has no keyless search).
// Without it, the caller falls back to a YouTube Music search link.

import { ConvertError } from '../errors.js';
import { cleanChannelName, decodeEntities, matchScore, parseYouTubeTitle } from '../text.js';
import { USER_AGENT } from './spotify.js';

const TIMEOUT_MS = 8000;
const MATCH_THRESHOLD = 0.72;

function timeoutSignal(ms = TIMEOUT_MS) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

/** "PT3M33S" -> 213000 */
export function isoDurationToMs(iso) {
  const m = String(iso || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
}

/**
 * YouTube Music's auto-generated tracks have a tidy description:
 *   Provided to YouTube by Columbia
 *
 *   Get Lucky · Daft Punk · Pharrell Williams · Nile Rodgers
 *
 *   Random Access Memories
 *   ...
 */
export function parseProvidedDescription(description) {
  const lines = String(description || '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (!/^Provided to YouTube by /i.test(lines[0] || '')) return null;
  const rest = lines.slice(1).filter(Boolean);
  const songLine = rest[0] || '';
  const parts = songLine.split(' · ').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [title, ...artists] = parts;
  const album = rest[1] && !/^(℗|©|Released on:|Auto-generated)/i.test(rest[1]) ? rest[1] : null;
  const released = rest.find((l) => /^Released on:/i.test(l));
  return {
    title,
    artists,
    album,
    releaseDate: released ? released.replace(/^Released on:\s*/i, '') : null,
  };
}

function thumbnail(id) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

async function oembed(url, fetch) {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
    signal: timeoutSignal(),
  }).catch((err) => {
    throw new ConvertError('UPSTREAM', `Couldn't reach YouTube (${err.message}).`, 502);
  });
  if (res.status === 404 || res.status === 400) {
    throw new ConvertError('NOT_FOUND', "YouTube doesn't know that link. Is it complete?", 404);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ConvertError('PRIVATE', 'That YouTube video is private or not shareable.', 403);
  }
  if (!res.ok) throw new ConvertError('UPSTREAM', `YouTube answered with an error (${res.status}).`, 502);
  return res.json();
}

/** Song info for a YouTube / YouTube Music link. */
export async function youtubeMetadata(parsed, { fetch = globalThis.fetch, env = {} } = {}) {
  if (parsed.kind === 'track') {
    if (env.YOUTUBE_API_KEY) {
      try {
        const meta = await dataApiVideo(parsed.id, env, fetch);
        if (meta) return meta;
      } catch (err) {
        console.warn('[streamBud] YouTube Data API:', err.message);
      }
    }
    const o = await oembed(`https://www.youtube.com/watch?v=${parsed.id}`, fetch);
    const p = parseYouTubeTitle(o.title, o.author_name);
    return {
      kind: 'track',
      id: parsed.id,
      title: p.title,
      artists: [p.artist, p.featured].filter(Boolean),
      rawTitle: o.title,
      artwork: thumbnail(parsed.id),
      url: parsed.url,
    };
  }

  if (parsed.kind === 'album') {
    const o = await oembed(`https://www.youtube.com/playlist?list=${parsed.id}`, fetch);
    const title = decodeEntities(o.title || '').replace(/^Album\s*[-–]\s*/i, '');
    return {
      kind: 'album',
      id: parsed.id,
      title,
      artists: [cleanChannelName(o.author_name || '')].filter(Boolean),
      artwork: o.thumbnail_url || null,
      url: parsed.url,
    };
  }

  throw new ConvertError('UNSUPPORTED_KIND', 'Only YouTube Music songs and albums can be converted.', 422);
}

async function dataApiVideo(id, env, fetch) {
  const url =
    'https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails' +
    `&id=${encodeURIComponent(id)}&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;
  const res = await fetch(url, { signal: timeoutSignal() });
  if (!res.ok) throw new Error(`videos.list failed (${res.status})`);
  const item = (await res.json())?.items?.[0];
  if (!item) throw new ConvertError('NOT_FOUND', "YouTube doesn't know that link. Is it complete?", 404);
  const s = item.snippet || {};
  const thumbs = s.thumbnails || {};
  const artwork = (thumbs.medium || thumbs.maxres || thumbs.high || thumbs.default || {}).url || thumbnail(id);
  const provided = parseProvidedDescription(s.description);
  const base = {
    kind: 'track',
    id,
    rawTitle: decodeEntities(s.title),
    durationMs: isoDurationToMs(item.contentDetails?.duration),
    artwork,
    url: `https://music.youtube.com/watch?v=${id}`,
  };
  if (provided) return { ...base, title: provided.title, artists: provided.artists, album: provided.album, releaseDate: provided.releaseDate };
  const p = parseYouTubeTitle(s.title, s.channelTitle);
  return { ...base, title: p.title, artists: [p.artist, p.featured].filter(Boolean) };
}

/**
 * Find a song on YouTube Music (needs YOUTUBE_API_KEY).
 * Returns { id, url, score, via } or null.
 */
export async function findOnYouTube(want, kind, { fetch = globalThis.fetch, env = {} } = {}) {
  if (!env.YOUTUBE_API_KEY || kind !== 'track' || !want?.title) return null;
  const q = [want.title, want.artists?.[0]].filter(Boolean).join(' ');
  const url =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=8' +
    `&q=${encodeURIComponent(q)}&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;
  try {
    const res = await fetch(url, { signal: timeoutSignal() });
    if (!res.ok) throw new Error(`search.list failed (${res.status})`);
    const items = (await res.json())?.items ?? [];
    let best = null;
    items.forEach((it, rank) => {
      const id = it?.id?.videoId;
      if (!id) return;
      const channel = decodeEntities(it.snippet?.channelTitle || '');
      const p = parseYouTubeTitle(it.snippet?.title || '', channel);
      let score = matchScore(want, { title: p.title, artists: [p.artist, p.featured].filter(Boolean) });
      // Prefer the artist's own uploads and YouTube Music's audio tracks.
      if (/\s-\s*topic$/i.test(channel) || /vevo$/i.test(channel)) score += 0.04;
      score -= rank * 0.01; // YouTube's own ranking is a decent tie-breaker
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { id, score };
    });
    if (!best) return null;
    return {
      ...best,
      url: `https://music.youtube.com/watch?v=${best.id}`,
      youtubeUrl: `https://www.youtube.com/watch?v=${best.id}`,
      via: 'youtube-api',
    };
  } catch (err) {
    console.warn('[streamBud] YouTube search:', err.message);
    return null;
  }
}
