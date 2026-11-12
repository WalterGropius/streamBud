import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanChannelName,
  cleanTrackTitle,
  decodeEntities,
  matchScore,
  normalize,
  parseYouTubeTitle,
  searchQuery,
} from '../lib/text.js';
import { parseProvidedDescription, isoDurationToMs } from '../lib/sources/youtube.js';

test('normalize', () => {
  assert.equal(normalize('Beyoncé – Halo!'), 'beyonce halo');
  assert.equal(normalize("Don't Stop Me Now"), 'dont stop me now');
  assert.equal(normalize('Simon & Garfunkel'), 'simon and garfunkel');
});

test('decodeEntities', () => {
  assert.equal(decodeEntities('Don&#39;t &amp; Won&#x27;t &quot;x&quot;'), `Don't & Won't "x"`);
});

test('cleanChannelName', () => {
  assert.equal(cleanChannelName('TheWeekndVEVO'), 'The Weeknd');
  assert.equal(cleanChannelName('Maroon5VEVO'), 'Maroon 5');
  assert.equal(cleanChannelName('Daft Punk - Topic'), 'Daft Punk');
  assert.equal(cleanChannelName('Queen Official'), 'Queen');
  assert.equal(cleanChannelName('Wiz Khalifa Music'), 'Wiz Khalifa');
  assert.equal(cleanChannelName('Ed Sheeran'), 'Ed Sheeran');
});

// Real video titles + channels, as YouTube returns them.
const YT_CASES = [
  [['Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', 'Rick Astley'], ['Rick Astley', 'Never Gonna Give You Up', null]],
  [['Luis Fonsi - Despacito ft. Daddy Yankee', 'LuisFonsiVEVO'], ['Luis Fonsi', 'Despacito', 'Daddy Yankee']],
  [['Ed Sheeran - Shape of You (Official Music Video)', 'Ed Sheeran'], ['Ed Sheeran', 'Shape of You', null]],
  [['The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO'], ['The Weeknd', 'Blinding Lights', null]],
  [['Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official'], ['Queen', 'Bohemian Rhapsody', null]],
  [['Wiz Khalifa - See You Again ft. Charlie Puth [Official Video] Furious 7 Soundtrack', 'Wiz Khalifa Music'], ['Wiz Khalifa', 'See You Again', 'Charlie Puth']],
  [['Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars', 'MarkRonsonVEVO'], ['Mark Ronson', 'Uptown Funk', 'Bruno Mars']],
  [['Get Lucky', 'Daft Punk - Topic'], ['Daft Punk', 'Get Lucky', null]],
  [['Bohemian Rhapsody - Remastered 2011', 'Queen - Topic'], ['Queen', 'Bohemian Rhapsody - Remastered 2011', null]],
  [['Blinding Lights', 'The Weeknd'], ['The Weeknd', 'Blinding Lights', null]],
  [["BLACKPINK - 'How You Like That' M/V", 'BLACKPINK'], ['BLACKPINK', 'How You Like That', null]],
  [['[MV] IU - Love wins all', '1theK (원더케이)'], ['IU', 'Love wins all', null]],
  [['Adele - Hello (Live at the NRJ Awards)', 'Adele'], ['Adele', 'Hello (Live at the NRJ Awards)', null]],
  [['Jay-Z - Empire State Of Mind ft. Alicia Keys', 'JayZVEVO'], ['Jay-Z', 'Empire State Of Mind', 'Alicia Keys']],
  [['Song Name | Official Music Video', 'Some Artist'], ['Some Artist', 'Song Name', null]],
];

for (const [[title, channel], [artist, song, featured]] of YT_CASES) {
  test(`parseYouTubeTitle: ${title}`, () => {
    const got = parseYouTubeTitle(title, channel);
    assert.equal(got.artist, artist);
    assert.equal(got.title, song);
    assert.equal(got.featured, featured);
  });
}

test('cleanTrackTitle strips remaster/feat noise but keeps real versions', () => {
  assert.equal(cleanTrackTitle('Bohemian Rhapsody - Remastered 2011'), 'Bohemian Rhapsody');
  assert.equal(cleanTrackTitle('Bohemian Rhapsody - 2011 Remaster'), 'Bohemian Rhapsody');
  assert.equal(cleanTrackTitle('Get Lucky (feat. Pharrell Williams & Nile Rodgers) - Radio Edit'), 'Get Lucky');
  assert.equal(cleanTrackTitle('Hello - Live at the NRJ Awards'), 'Hello - Live at the NRJ Awards');
  assert.equal(cleanTrackTitle('Creep (Acoustic Version)'), 'Creep (Acoustic Version)');
  assert.equal(cleanTrackTitle('Song (Single Version)'), 'Song');
});

test('matchScore: same song scores high, other versions score low', () => {
  const want = { title: 'Never Gonna Give You Up', artists: ['Rick Astley'] };
  assert.ok(matchScore(want, { title: 'Never Gonna Give You Up', artists: ['Rick Astley'] }) > 0.95);
  assert.ok(matchScore(want, { title: 'Never Gonna Give You Up - 2022 Remaster', artists: ['Rick Astley'] }) > 0.9);
  assert.ok(matchScore(want, { title: 'Never Gonna Give You Up (Live)', artists: ['Rick Astley'] }) < 0.8);
  assert.ok(matchScore(want, { title: 'Never Gonna Give You Up (Karaoke Version)', artists: ['Karaoke Kings'] }) < 0.72);
  assert.ok(matchScore(want, { title: 'Together Forever', artists: ['Rick Astley'] }) < 0.5);
  const collab = { title: 'Despacito', artists: ['Luis Fonsi', 'Daddy Yankee'] };
  assert.ok(matchScore(collab, { title: 'Despacito', artists: ['Luis Fonsi', 'Daddy Yankee'] }) > 0.95);
  assert.ok(matchScore({ title: 'Blinding Lights', artists: ['Weeknd'] }, { title: 'Blinding Lights', artists: ['The Weeknd'] }) > 0.95);
});

test('searchQuery', () => {
  assert.equal(searchQuery({ title: 'Bohemian Rhapsody - Remastered 2011', artists: ['Queen'] }), 'Bohemian Rhapsody Queen');
  assert.equal(searchQuery({ title: 'Untitled', artists: [] }), 'Untitled');
});

test('parseProvidedDescription reads YouTube Music auto-generated descriptions', () => {
  const d = [
    'Provided to YouTube by Columbia',
    '',
    'Get Lucky · Daft Punk · Pharrell Williams · Nile Rodgers',
    '',
    'Random Access Memories',
    '',
    '℗ 2013 Daft Life Limited',
    '',
    'Released on: 2013-05-17',
    '',
    'Auto-generated by YouTube.',
  ].join('\n');
  assert.deepEqual(parseProvidedDescription(d), {
    title: 'Get Lucky',
    artists: ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'],
    album: 'Random Access Memories',
    releaseDate: '2013-05-17',
  });
  assert.equal(parseProvidedDescription('Just a normal description'), null);
});

test('isoDurationToMs', () => {
  assert.equal(isoDurationToMs('PT3M33S'), 213000);
  assert.equal(isoDurationToMs('PT1H2M'), 3720000);
  assert.equal(isoDurationToMs('bogus'), null);
});
