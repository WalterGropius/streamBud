// Text helpers: turning messy video titles into "artist + song", and deciding
// whether two songs are the same song.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", nbsp: ' ' };

/** YouTube's API returns HTML-escaped titles ("Don&#39;t Stop"). */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const key = e.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return m;
  });
}

/** Lowercase, strip accents and punctuation: "Beyoncé – Halo!" -> "beyonce halo". */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(s) {
  return normalize(s).split(' ').filter(Boolean);
}

/** Word-overlap similarity between 0 and 1 (Dice coefficient). */
export function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  if ([...A].join(' ') === [...B].join(' ')) return 1;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

// Words that mean "a different recording of the song". If one side has one
// of these and the other doesn't, it's probably not the version you want.
const VERSION_TAGS = [
  'live', 'remix', 'acoustic', 'instrumental', 'karaoke', 'cover', 'sped up', 'speed up',
  'slowed', 'reverb', 'nightcore', '8d', 'demo', 'acapella', 'a cappella', 'piano version',
  'lofi', 'lo fi', 'extended', 'unplugged', 'orchestral', 'tribute',
];

export function versionTags(s) {
  const n = ` ${normalize(s)} `;
  return VERSION_TAGS.filter((tag) => n.includes(` ${tag} `));
}

// Video-only noise that never belongs in a song title.
const VIDEO_NOISE =
  /\b(official|video|videoclip|clip officiel|audio|lyrics?|letra|visuali[sz]er|mv|m\/v|hd|hq|[48]k|remaster(ed)?|explicit|clean|color coded|performance|full song|topic|music video|from .+ soundtrack|soundtrack version)\b/i;

const FEAT = /\s*[([]?\s*\b(?:ft|feat|featuring)\b\.?\s+([^)\]]+?)\s*[)\]]?\s*$/i;

/** Remove a trailing "feat. X" from a title/artist string. Returns [rest, featured|null]. */
function splitFeaturing(s) {
  // feat. can be in the middle too: "Song (feat. X) [Live]"
  const inner = s.match(/\s*[([]\s*(?:ft|feat|featuring)\b\.?\s+([^)\]]+)[)\]]/i);
  if (inner) return [(s.slice(0, inner.index) + s.slice(inner.index + inner[0].length)).trim(), inner[1].trim()];
  const m = s.match(FEAT);
  if (m) return [s.slice(0, m.index).trim(), m[1].trim()];
  return [s.trim(), null];
}

/** "TheWeekndVEVO" -> "The Weeknd", "Queen Official" -> "Queen", "Daft Punk - Topic" -> "Daft Punk". */
export function cleanChannelName(name) {
  let s = decodeEntities(name).trim();
  s = s.replace(/\s*-\s*topic$/i, '');
  if (/vevo$/i.test(s)) {
    s = s.replace(/vevo$/i, '');
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
  }
  s = s.replace(/\s+(official|music|tv|channel)$/i, '').trim();
  return s;
}

const SEPARATOR = /\s+[-–—~|]\s+|\s+[-–—]\s*|\s*[-–—]\s+/;

/**
 * Turn a YouTube video title + channel into { title, artist, featured }.
 *   "Luis Fonsi - Despacito ft. Daddy Yankee" / "LuisFonsiVEVO"
 *     -> { title: "Despacito", artist: "Luis Fonsi", featured: "Daddy Yankee" }
 *   "Get Lucky" / "Daft Punk - Topic" -> { title: "Get Lucky", artist: "Daft Punk" }
 */
export function parseYouTubeTitle(rawTitle, rawChannel = '') {
  let t = decodeEntities(rawTitle).replace(/\s+/g, ' ').trim();
  const channel = decodeEntities(rawChannel).trim();
  const isTopic = /\s-\s*topic$/i.test(channel);
  let featured = null;

  // Bracketed bits: drop the ones that are video noise. Everything after the
  // first "(Official Video)" is usually junk too ("... [Official Video] Furious 7 Soundtrack").
  const bracket = /\s*(\([^)]*\)|\[[^\]]*\]|【[^】]*】)/g;
  const isNoise = (inside) => VIDEO_NOISE.test(inside) && !/^\s*(ft|feat|featuring)\b/i.test(inside);
  for (const m of t.matchAll(bracket)) {
    if (!isNoise(m[1].slice(1, -1))) continue;
    if (!t.slice(0, m.index).trim()) continue; // a leading tag like "[MV] ..." just gets removed below
    const tail = t.slice(m.index + m[0].length);
    const ft = tail.match(/^\s*\b(?:ft|feat|featuring)\b\.?\s+(.+?)(?:\s*[([|].*)?$/i);
    if (ft) featured = ft[1].trim();
    t = t.slice(0, m.index);
    break;
  }
  t = t.replace(bracket, (whole, inner) => (isNoise(inner.slice(1, -1)) ? '' : whole)).trim();

  // "Song | Official Video", "Song // Lyrics"
  t = t.split(/\s+(?:\||｜|\/\/)\s+/)[0].trim();
  // Trailing un-bracketed noise: "Song Official Music Video", "Song Lyrics"
  t = t
    .replace(/\s+(official\s+(music\s+)?video|official\s+audio|official\s+lyric\s+video|lyric\s+video|lyrics|visuali[sz]er|m\/?v)\s*$/i, '')
    .trim();

  let artist;
  let title;
  const sep = isTopic ? null : t.match(SEPARATOR);
  if (sep) {
    artist = t.slice(0, sep.index).trim();
    title = t.slice(sep.index + sep[0].length).trim();
  } else {
    // K-pop style: ARTIST 'Song' or ARTIST "Song"
    const quoted = !isTopic && t.match(/^(.+?)\s+['"‘“「『](.+)['"’”」』]$/);
    if (quoted) {
      artist = quoted[1].trim();
      title = quoted[2].trim();
    } else {
      artist = cleanChannelName(channel);
      title = t;
    }
  }

  let f;
  [title, f] = splitFeaturing(title);
  featured = featured || f;
  [artist, f] = splitFeaturing(artist);
  featured = featured || f;

  title = title.replace(/^['"‘“「『]+|['"’”」』]+$/g, '').trim();
  if (!title) title = decodeEntities(rawTitle).trim();
  if (!artist) artist = cleanChannelName(channel);
  return { title, artist, featured };
}

/**
 * Clean a streaming-service title for searching elsewhere:
 * "Bohemian Rhapsody - Remastered 2011" -> "Bohemian Rhapsody"
 * "Song (feat. X)" -> "Song". Keeps meaningful versions like "Live" or "Remix".
 */
export function cleanTrackTitle(title) {
  let t = decodeEntities(title).trim();
  [t] = splitFeaturing(t);
  const boring = (s) =>
    /remaster|single version|album version|radio edit|\bmono\b|\bstereo\b|deluxe|bonus track|\bversion\b/i.test(s) &&
    versionTags(s).length === 0;
  t = t.replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner) => (boring(inner) ? '' : whole));
  t = t.replace(/\s+-\s+(.*)$/, (whole, rest) => (boring(rest) ? '' : whole));
  return t.trim() || String(title).trim();
}

/** How well does a candidate match what we're looking for? 0..1 */
export function matchScore(want, got) {
  const wantTitle = cleanTrackTitle(want.title);
  const gotTitle = cleanTrackTitle(got.title);
  const titleSim = Math.max(similarity(wantTitle, gotTitle), containment(wantTitle, gotTitle));

  const wantArtists = [].concat(want.artists || want.artist || []).filter(Boolean);
  const gotArtists = [].concat(got.artists || got.artist || []).filter(Boolean);
  let artistSim = 0;
  if (!wantArtists.length || !gotArtists.length) {
    artistSim = 0.5; // unknown: neither help nor hurt much
  } else {
    for (const a of wantArtists) {
      for (const b of gotArtists) {
        artistSim = Math.max(artistSim, similarity(stripThe(a), stripThe(b)), containment(stripThe(a), stripThe(b)));
      }
    }
    // "Daft Punk" vs "Daft Punk, Pharrell Williams"
    artistSim = Math.max(artistSim, containment(stripThe(wantArtists.join(' ')), stripThe(gotArtists.join(' '))));
  }

  let score = 0.65 * titleSim + 0.35 * artistSim;
  const wantTags = new Set(versionTags(want.title));
  const gotTags = new Set(versionTags(got.title));
  for (const tag of gotTags) if (!wantTags.has(tag)) score -= 0.25;
  for (const tag of wantTags) if (!gotTags.has(tag)) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}

function stripThe(s) {
  return normalize(s).replace(/^the /, '');
}

/** 0.9 when every word of the shorter string appears in the longer one. */
function containment(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const [short, long] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)];
  return short.every((t) => long.has(t)) ? 0.9 : 0;
}

/** "Bohemian Rhapsody Queen" — what you'd type into a search box. */
export function searchQuery(meta) {
  const title = meta.kind === 'artist' ? '' : cleanTrackTitle(meta.title || '');
  const artist = (meta.artists && meta.artists[0]) || meta.artist || '';
  return [title, artist].filter(Boolean).join(' ').trim() || (meta.title || '').trim();
}
