// The whole conversion: link in, links out.

import { ConvertError } from './errors.js';
import { PLATFORM_NAMES, searchLinks, songLinkPage } from './links.js';
import { extractUrl, parseLink } from './parse.js';
import { findOnSpotify, resolveSpotifyShortLink, spotifyMetadata } from './sources/spotify.js';
import { findOnYouTube, youtubeMetadata } from './sources/youtube.js';
import { cleanTrackTitle, searchQuery } from './text.js';

export { ConvertError };

const KIND_LABELS = { track: 'Song', album: 'Album', artist: 'Artist' };

/**
 * Convert a Spotify link to YouTube Music, or a YouTube (Music) link to Spotify.
 *
 * @param {string} input  A link, or a whole message that contains one.
 * @param {{ fetch?: typeof fetch, env?: Record<string, string|undefined> }} [options]
 */
export async function convert(input, { fetch = globalThis.fetch, env = {} } = {}) {
  const url = extractUrl(input);
  if (!url) throw new ConvertError('NO_LINK', "There's no link in there. Paste a Spotify or YouTube Music link.", 400);

  let link = parseLink(url);
  if (!link) {
    throw new ConvertError('UNSUPPORTED_LINK', 'That link isn’t from Spotify or YouTube Music.', 400);
  }

  if (link.kind === 'short') {
    const resolved = await resolveSpotifyShortLink(link.url, { fetch });
    link = parseLink(resolved);
    if (!link) throw new ConvertError('SHORT_LINK', "Couldn't open that Spotify short link. Try copying the full link instead.", 422);
  }

  if (link.kind === 'playlist') {
    throw new ConvertError(
      'UNSUPPORTED_KIND',
      'Playlists can’t be converted (yet). Send a song or album link instead.',
      422,
    );
  }
  if (link.kind === 'episode' || link.kind === 'show') {
    throw new ConvertError('UNSUPPORTED_KIND', 'Podcasts aren’t on YouTube Music the same way, so they can’t be converted.', 422);
  }
  if (link.unresolvable) {
    throw new ConvertError(
      'UNSUPPORTED_KIND',
      'That kind of YouTube Music page can’t be converted. Open a song and share that instead.',
      422,
    );
  }

  const opts = { fetch, env };
  const targets = {};
  let meta;
  let primary;

  if (link.platform === 'spotify') {
    meta = await spotifyMetadata(link.kind, link.id, opts);
    primary = 'youtubeMusic';
    const query = searchQuery(meta);
    const want = { title: cleanTrackTitle(meta.title), artists: meta.artists };
    const hit = link.kind === 'track' ? await findOnYouTube(want, 'track', opts) : null;

    targets.youtubeMusic = hit
      ? { url: hit.url, match: 'direct' }
      : { url: searchLinks.youtubeMusic(query), match: 'search' };
    targets.spotify = { url: link.url, match: 'source' };
    targets.youtube = hit
      ? { url: hit.youtubeUrl, match: 'direct' }
      : { url: searchLinks.youtube(query), match: 'search' };
  } else {
    meta = await youtubeMetadata(link, opts);
    primary = 'spotify';
    const query = searchQuery(meta);
    const hit = await findOnSpotify({ title: meta.title, artists: meta.artists }, link.kind, opts);

    targets.spotify = hit
      ? { url: hit.url, match: 'direct' }
      : { url: searchLinks.spotify(query), match: 'search' };
    targets.youtubeMusic = { url: link.url, match: 'source' };
    if (link.kind === 'track') {
      targets.youtube = { url: `https://www.youtube.com/watch?v=${link.id}`, match: 'source' };
    }
  }

  const query = searchQuery(meta);
  const more = ['appleMusic', 'deezer', 'tidal', 'soundcloud', 'amazonMusic'].map((key) => ({
    key,
    name: PLATFORM_NAMES[key],
    url: searchLinks[key](query),
  }));
  if (link.kind !== 'artist') more.push({ key: 'songlink', name: 'All services (song.link)', url: songLinkPage(link.url) });

  return {
    source: { platform: link.platform, kind: link.kind, id: link.id, url: link.url },
    meta: {
      title: meta.title,
      artists: meta.artists ?? [],
      artist: (meta.artists ?? []).join(', '),
      album: meta.album ?? null,
      kindLabel: KIND_LABELS[link.kind] ?? 'Song',
      artwork: meta.artwork ?? null,
      durationMs: meta.durationMs ?? null,
    },
    query,
    primary,
    targets,
    more,
  };
}
