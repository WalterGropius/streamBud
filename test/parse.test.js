import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractUrl, looksLikeMusicLink, parseLink } from '../lib/parse.js';

test('extractUrl finds a link inside a message', () => {
  assert.equal(
    extractUrl('omg listen to this https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc!!'),
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc',
  );
  assert.equal(extractUrl('(https://youtu.be/dQw4w9WgXcQ)'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(extractUrl('music.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(extractUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(extractUrl('no link here'), null);
  assert.equal(extractUrl(''), null);
  assert.equal(extractUrl(null), null);
});

test('parseLink understands Spotify links', () => {
  assert.deepEqual(parseLink('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=xyz'), {
    platform: 'spotify',
    kind: 'track',
    id: '4cOdK2wGLETKBW3PvgPWqT',
    url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  });
  assert.equal(parseLink('https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT').id, '4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(parseLink('https://open.spotify.com/intl-pt-br/album/6XhjNHCyCDyyGJRM5mg40G').kind, 'album');
  assert.equal(parseLink('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT').kind, 'track');
  assert.equal(parseLink('https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt').kind, 'artist');
  assert.equal(parseLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').kind, 'playlist');
  assert.equal(parseLink('https://spotify.link/AbCdEf123').kind, 'short');
  assert.equal(parseLink('https://open.spotify.com/track/tooShort'), null);
});

test('parseLink understands YouTube and YouTube Music links', () => {
  const expected = {
    platform: 'youtube',
    kind: 'track',
    id: 'dQw4w9WgXcQ',
    url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  };
  for (const link of [
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  ]) {
    assert.deepEqual(parseLink(link), expected, link);
  }
  const album = parseLink('https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnopqrstuvwxyz12345');
  assert.equal(album.kind, 'album');
  assert.equal(parseLink('https://www.youtube.com/playlist?list=PL1234567890abcdef').kind, 'playlist');
  assert.equal(parseLink('https://music.youtube.com/browse/MPREb_abc123').unresolvable, true);
  assert.equal(parseLink('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseLink('not a url'), null);
});

test('looksLikeMusicLink', () => {
  assert.equal(looksLikeMusicLink('hey https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(looksLikeMusicLink('https://example.com'), false);
});
