// Link detection: pull a music link out of whatever was pasted and work out
// which service, what kind of thing (song, album...) and its ID.

const SPOTIFY_KINDS = new Set(['track', 'album', 'artist', 'playlist', 'episode', 'show']);
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const TRAILING_PUNCTUATION = /[).,!?\]}>'"]+$/;

/**
 * Find the first link in a blob of text, e.g. a message like
 * "omg listen to this https://open.spotify.com/track/...?si=abc".
 * Also understands spotify: URIs and links pasted without https://.
 */
export function extractUrl(text) {
  if (text == null) return null;
  const t = String(text).trim();
  if (!t) return null;

  const uri = t.match(/spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]{22})/);
  if (uri) return `https://open.spotify.com/${uri[1]}/${uri[2]}`;

  const full = t.match(/https?:\/\/[^\s<>"]+/i);
  if (full) return full[0].replace(TRAILING_PUNCTUATION, '');

  const bare = t.match(
    /(?:^|[\s(])((?:[\w-]+\.)*(?:spotify\.com|spotify\.link|spoti\.fi|youtube\.com|youtu\.be)\/[^\s<>"]+)/i,
  );
  if (bare) return 'https://' + bare[1].replace(TRAILING_PUNCTUATION, '');

  return null;
}

function toUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Identify a music link.
 * Returns { platform, kind, id, url } or null if it isn't a link we know.
 *   platform: 'spotify' | 'youtube'
 *   kind:     'track' | 'album' | 'artist' | 'playlist' | 'episode' | 'show' | 'short'
 *   url:      a clean canonical link (tracking params like ?si= removed)
 */
export function parseLink(raw) {
  const u = toUrl(raw);
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  // --- Spotify ---------------------------------------------------------
  if (host === 'open.spotify.com' || host === 'play.spotify.com' || host === 'spotify.com') {
    let p = parts;
    if (p[0] && /^intl-[a-z]{2}(-[a-z]{2})?$/i.test(p[0])) p = p.slice(1);
    if (p[0] === 'embed') p = p.slice(1);
    // Old-style user playlists: /user/<name>/playlist/<id>
    if (p[0] === 'user' && p[2] === 'playlist') p = p.slice(2);
    const [kind, id] = p;
    if (SPOTIFY_KINDS.has(kind) && SPOTIFY_ID.test(id || '')) {
      return { platform: 'spotify', kind, id, url: `https://open.spotify.com/${kind}/${id}` };
    }
    return null;
  }

  // Spotify short links from the app's share button: spotify.link/AbC123
  if (host === 'spotify.link' || host === 'spoti.fi') {
    const code = parts[0];
    if (code && /^[A-Za-z0-9_-]{4,64}$/.test(code)) {
      return { platform: 'spotify', kind: 'short', id: code, url: `https://${host}/${code}` };
    }
    return null;
  }

  // --- YouTube / YouTube Music ------------------------------------------
  if (host === 'youtu.be') {
    const id = parts[0];
    if (YT_VIDEO_ID.test(id || '')) return youtubeTrack(id);
    return null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    if ((parts[0] === 'watch' || parts.length === 0) && YT_VIDEO_ID.test(v || '')) return youtubeTrack(v);
    if (['shorts', 'live', 'embed', 'v'].includes(parts[0]) && YT_VIDEO_ID.test(parts[1] || '')) {
      return youtubeTrack(parts[1]);
    }
    if (parts[0] === 'playlist') {
      const list = u.searchParams.get('list') || '';
      if (!YT_LIST_ID.test(list)) return null;
      // YouTube Music albums are playlists whose IDs start with OLAK5uy_
      const kind = list.startsWith('OLAK5uy_') ? 'album' : 'playlist';
      return {
        platform: 'youtube',
        kind,
        id: list,
        url: `https://music.youtube.com/playlist?list=${list}`,
      };
    }
    if (parts[0] === 'browse' && parts[1]) {
      const kind = parts[1].startsWith('MPREb_') ? 'album' : parts[1].startsWith('UC') ? 'artist' : 'playlist';
      return { platform: 'youtube', kind, id: parts[1], url: `https://music.youtube.com/browse/${parts[1]}`, unresolvable: true };
    }
    if (parts[0] === 'channel' && parts[1]) {
      return { platform: 'youtube', kind: 'artist', id: parts[1], url: `https://music.youtube.com/channel/${parts[1]}`, unresolvable: true };
    }
    return null;
  }

  return null;
}

function youtubeTrack(id) {
  return { platform: 'youtube', kind: 'track', id, url: `https://music.youtube.com/watch?v=${id}` };
}

/** Quick check used by the UI to decide whether to auto-convert while typing. */
export function looksLikeMusicLink(text) {
  const url = extractUrl(text);
  return Boolean(url && parseLink(url));
}
