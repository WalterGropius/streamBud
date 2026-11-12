// Search links for every service. These always work, need no API, and open
// straight in the app on a phone.

const enc = encodeURIComponent;

export const searchLinks = {
  spotify: (q) => `https://open.spotify.com/search/${enc(q)}`,
  youtubeMusic: (q) => `https://music.youtube.com/search?q=${enc(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${enc(q)}`,
  appleMusic: (q) => `https://music.apple.com/search?term=${enc(q)}`,
  deezer: (q) => `https://www.deezer.com/search/${enc(q)}`,
  tidal: (q) => `https://tidal.com/search?q=${enc(q)}`,
  soundcloud: (q) => `https://soundcloud.com/search?q=${enc(q)}`,
  amazonMusic: (q) => `https://music.amazon.com/search/${enc(q)}`,
};

export const PLATFORM_NAMES = {
  spotify: 'Spotify',
  youtubeMusic: 'YouTube Music',
  youtube: 'YouTube',
  appleMusic: 'Apple Music',
  deezer: 'Deezer',
  tidal: 'Tidal',
  soundcloud: 'SoundCloud',
  amazonMusic: 'Amazon Music',
};

/** song.link's public page lists the song on every service. */
export function songLinkPage(sourceUrl) {
  return `https://song.link/${sourceUrl}`;
}
