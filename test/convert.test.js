import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convert } from '../lib/convert.js';
import { handleConvert } from '../lib/http.js';

// A tiny fake internet: route URL patterns to canned responses.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    for (const [pattern, reply] of routes) {
      if (pattern.test(u)) {
        const r = typeof reply === 'function' ? reply(u, init) : reply;
        const status = r.status ?? 200;
        const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        return new Response(body, { status, headers: r.headers ?? {} });
      }
    }
    return new Response('not found', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

function embedPage(entity) {
  const data = { props: { pageProps: { state: { data: { entity } } } } };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

const RICK = {
  type: 'track',
  name: 'Never Gonna Give You Up',
  artists: [{ name: 'Rick Astley' }],
  duration: 213573,
  isPlayable: true,
  releaseDate: { isoString: '1987-11-12T00:00:00Z' },
  visualIdentity: { image: [{ url: 'https://img/300', maxWidth: 300 }, { url: 'https://img/640', maxWidth: 640 }] },
};

test('Spotify -> YouTube Music without a key gives a search link', async () => {
  const fetch = fakeFetch([[/open\.spotify\.com\/embed\/track\//, { body: embedPage(RICK) }]]);
  const r = await convert('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc', { fetch });
  assert.equal(r.primary, 'youtubeMusic');
  assert.equal(r.meta.title, 'Never Gonna Give You Up');
  assert.equal(r.meta.artist, 'Rick Astley');
  assert.equal(r.meta.artwork, 'https://img/640');
  assert.deepEqual(r.targets.youtubeMusic, {
    url: 'https://music.youtube.com/search?q=Never%20Gonna%20Give%20You%20Up%20Rick%20Astley',
    match: 'search',
  });
  assert.equal(r.targets.spotify.url, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.ok(r.more.some((m) => m.key === 'songlink'));
});

test('Spotify -> YouTube Music with a YouTube API key gives a direct link', async () => {
  const fetch = fakeFetch([
    [/open\.spotify\.com\/embed\/track\//, { body: embedPage(RICK) }],
    [
      /googleapis\.com\/youtube\/v3\/search/,
      {
        body: {
          items: [
            { id: { videoId: 'karaoke0001' }, snippet: { title: 'Never Gonna Give You Up (Karaoke Version)', channelTitle: 'Sing King' } },
            { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', channelTitle: 'Rick Astley' } },
          ],
        },
      },
    ],
  ]);
  const r = await convert('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', { fetch, env: { YOUTUBE_API_KEY: 'k' } });
  assert.deepEqual(r.targets.youtubeMusic, { url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', match: 'direct' });
  assert.deepEqual(r.targets.youtube, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', match: 'direct' });
});

test('YouTube Music -> Spotify via ListenBrainz, verified against Spotify', async () => {
  const fetch = fakeFetch([
    [/youtube\.com\/oembed/, { body: { title: 'Rick Astley - Never Gonna Give You Up (Official Video)', author_name: 'Rick Astley' } }],
    [/listenbrainz\.org\/spotify-id-from-metadata/, { body: [{ spotify_track_ids: ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBB'] }] }],
    // First candidate is a different song; second is right.
    [/embed\/track\/AAAAAAAAAAAAAAAAAAAAAA/, { body: embedPage({ ...RICK, name: 'Together Forever' }) }],
    [/embed\/track\/BBBBBBBBBBBBBBBBBBBBBB/, { body: embedPage(RICK) }],
  ]);
  const r = await convert('https://music.youtube.com/watch?v=dQw4w9WgXcQ', { fetch });
  assert.equal(r.primary, 'spotify');
  assert.deepEqual(r.targets.spotify, { url: 'https://open.spotify.com/track/BBBBBBBBBBBBBBBBBBBBBB', match: 'direct' });
  assert.equal(r.targets.youtubeMusic.url, 'https://music.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('YouTube -> Spotify falls back to a search link when nothing matches', async () => {
  const fetch = fakeFetch([
    [/youtube\.com\/oembed/, { body: { title: 'Get Lucky', author_name: 'Daft Punk - Topic' } }],
    [/listenbrainz/, { body: [{ spotify_track_ids: [] }] }],
  ]);
  const r = await convert('https://youtu.be/5NV6Rdv1a3I', { fetch });
  assert.deepEqual(r.targets.spotify, { url: 'https://open.spotify.com/search/Get%20Lucky%20Daft%20Punk', match: 'search' });
});

test('YouTube -> Spotify with Spotify API credentials', async () => {
  const fetch = fakeFetch([
    [/youtube\.com\/oembed/, { body: { title: 'Get Lucky', author_name: 'Daft Punk - Topic' } }],
    [/accounts\.spotify\.com\/api\/token/, { body: { access_token: 't', expires_in: 3600 } }],
    [
      /api\.spotify\.com\/v1\/search/,
      {
        body: {
          tracks: {
            items: [
              { id: '69kOkLUCkxIZYexIgSG8rq', name: 'Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]', artists: [{ name: 'Daft Punk' }, { name: 'Pharrell Williams' }], album: { release_date: '2013-04-19' } },
            ],
          },
        },
      },
    ],
  ]);
  const r = await convert('https://youtu.be/5NV6Rdv1a3I', { fetch, env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' } });
  assert.deepEqual(r.targets.spotify, { url: 'https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq', match: 'direct' });
});

test('YouTube Data API metadata is used when a key is set', async () => {
  const fetch = fakeFetch([
    [
      /googleapis\.com\/youtube\/v3\/videos/,
      {
        body: {
          items: [
            {
              snippet: {
                title: 'Get Lucky',
                channelTitle: 'Daft Punk - Topic',
                description: 'Provided to YouTube by Columbia\n\nGet Lucky · Daft Punk · Pharrell Williams\n\nRandom Access Memories\n\nReleased on: 2013-05-17',
                thumbnails: { high: { url: 'https://i.ytimg.com/x.jpg' } },
              },
              contentDetails: { duration: 'PT6M9S' },
            },
          ],
        },
      },
    ],
    [/listenbrainz/, { body: [{ spotify_track_ids: [] }] }],
  ]);
  const r = await convert('https://music.youtube.com/watch?v=5NV6Rdv1a3I', { fetch, env: { YOUTUBE_API_KEY: 'k' } });
  assert.equal(r.meta.title, 'Get Lucky');
  assert.deepEqual(r.meta.artists, ['Daft Punk', 'Pharrell Williams']);
  assert.equal(r.meta.album, 'Random Access Memories');
  assert.equal(r.meta.durationMs, 369000);
});

test('Spotify short links are followed', async () => {
  const fetch = fakeFetch([
    [/spotify\.link\//, { status: 302, headers: { location: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=1' }, body: '' }],
    [/open\.spotify\.com\/embed\/track\//, { body: embedPage(RICK) }],
  ]);
  const r = await convert('https://spotify.link/AbCdEf123', { fetch });
  assert.equal(r.source.id, '4cOdK2wGLETKBW3PvgPWqT');
});

test('falls back to oEmbed when the Spotify embed page is unreadable', async () => {
  const fetch = fakeFetch([
    [/open\.spotify\.com\/embed\//, { body: '<html>changed layout</html>' }],
    [/open\.spotify\.com\/oembed/, { body: { title: 'Never Gonna Give You Up', thumbnail_url: 'https://img/t' } }],
  ]);
  const r = await convert('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', { fetch });
  assert.equal(r.meta.title, 'Never Gonna Give You Up');
  assert.equal(r.targets.youtubeMusic.match, 'search');
});

test('friendly errors', async () => {
  const fetch = fakeFetch([[/open\.spotify\.com\/embed\//, { status: 404, body: '' }]]);
  await assert.rejects(convert('hello', { fetch }), { code: 'NO_LINK' });
  await assert.rejects(convert('https://example.com/x', { fetch }), { code: 'UNSUPPORTED_LINK' });
  await assert.rejects(convert('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { fetch }), { code: 'UNSUPPORTED_KIND' });
  await assert.rejects(convert('https://open.spotify.com/track/0000000000000000000000', { fetch }), { code: 'NOT_FOUND' });
});

test('handleConvert returns JSON with cache headers', async () => {
  const fetch = fakeFetch([[/open\.spotify\.com\/embed\/track\//, { body: embedPage(RICK) }]]);
  const ok = await handleConvert(new URLSearchParams({ url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' }), { fetch });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['cache-control'], /s-maxage=86400/);
  const bad = await handleConvert(new URLSearchParams({ url: '' }), { fetch });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'NO_LINK');
});
