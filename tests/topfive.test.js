// Tests for js/topfive.js. Run with: node --test
// Synthetic records only -- never commit real listening history.

const test = require('node:test');
const assert = require('node:assert/strict');
const TopFive = require('../js/topfive.js');

const TZ = 'America/Chicago';
const MIN = 60000;

function rec(ts, artist, track, extra = {}) {
  return {
    ts,
    ms_played: 3 * MIN,
    master_metadata_track_name: track,
    master_metadata_album_artist_name: artist,
    master_metadata_album_album_name: extra.album || `${artist} LP`,
    skipped: false,
    shuffle: false,
    platform: '',
    incognito_mode: false,
    ...extra,
  };
}

// n plays of one track, one per day starting at `startDate` (noon UTC = 6/7am Central).
function daily(startDate, n, artist, track, extra) {
  const out = [];
  const t0 = Date.parse(startDate + 'T12:00:00Z');
  for (let i = 0; i < n; i++) out.push(rec(new Date(t0 + i * 86400000).toISOString(), artist, track, extra));
  return out;
}

const build = (records, today = '2030-01-01') => TopFive.buildTopFive(records, { timeZone: TZ, today });
const names = (top) => top.items.map((i) => i.name);

/* ---------------- window boundaries ---------------- */

test('year boundary uses local (Central) time, not UTC', () => {
  // 2024-01-01T05:30Z is 11:30pm Dec 31, 2023 in Chicago (CST, UTC-6)
  const r = build([rec('2024-01-01T05:30:00Z', 'A', 'a'), rec('2024-01-01T06:30:00Z', 'B', 'b')]);
  assert.deepEqual(names(r.years[2023].full.top.artists.plays), ['A']);
  assert.deepEqual(names(r.years[2024].full.top.artists.plays), ['B']);
});

test('Wrapped window ends at the end of Nov 15 local time', () => {
  const r = build([
    rec('2024-11-16T05:59:00Z', 'In', 'x'),   // Nov 15, 11:59pm CST
    rec('2024-11-16T06:01:00Z', 'Out', 'y'),  // Nov 16, 12:01am CST
  ]);
  const y = r.years[2024];
  assert.deepEqual(y.wrapped.range, ['2024-01-01', '2024-11-15']);
  assert.deepEqual(names(y.wrapped.top.artists.plays), ['In']);
  assert.deepEqual(names(y.full.top.artists.plays).sort(), ['In', 'Out']);
  assert.equal(y.diff.after_cutoff.plays, 1);
});

test('local hour follows daylight saving time', () => {
  // 17:00Z is noon in July (CDT, UTC-5) and 11am in January (CST, UTC-6)
  const r = build([rec('2024-07-10T17:00:00Z', 'A', 'a'), rec('2024-01-10T17:00:00Z', 'A', 'a')]);
  const hours = r.years[2024].full.clock.hours;
  assert.equal(hours[12], 3);
  assert.equal(hours[11], 3);
});

test('Private Session plays count for Full Year but not the Wrapped window', () => {
  const r = build([
    rec('2024-03-01T18:00:00Z', 'Public', 'p'),
    rec('2024-03-02T18:00:00Z', 'Private', 'q', { incognito_mode: true }),
  ]);
  const y = r.years[2024];
  assert.deepEqual(names(y.wrapped.top.artists.plays), ['Public']);
  assert.equal(y.full.totals.plays, 2);
  assert.equal(y.diff.incognito_excluded.plays, 1);
  const row = y.diff.categories.artists.plays.find((x) => x.name === 'Private');
  assert.equal(row.status, 'entered');
  assert.equal(row.wrapped_rank, null);
});

test('plays under 30 seconds do not count but feed the skip rate', () => {
  const r = build([
    rec('2024-03-01T18:00:00Z', 'A', 'a'),
    rec('2024-03-01T18:05:00Z', 'B', 'b', { ms_played: 29999, skipped: true }),
  ]);
  const w = r.years[2024].full;
  assert.equal(w.totals.plays, 1);
  assert.deepEqual(names(w.top.artists.plays), ['A']);
  assert.equal(w.totals.skip_rate, 0.5);
});

/* ---------------- ties ---------------- */

test('equal play counts share a rank and are ordered by minutes', () => {
  const stats = new Map([
    ['A', { name: 'A', plays: 10, ms: 30 * MIN }],
    ['B', { name: 'B', plays: 8, ms: 20 * MIN }],
    ['C', { name: 'C', plays: 8, ms: 25 * MIN }],
    ['D', { name: 'D', plays: 5, ms: 99 * MIN }],
  ]);
  const top = TopFive.rankTop(stats, 'plays');
  assert.deepEqual(top.items.map((i) => [i.name, i.rank, i.tied]), [
    ['A', 1, false], ['C', 2, true], ['B', 2, true], ['D', 4, false],
  ]);
  // by minutes the order is completely different and nobody ties
  assert.deepEqual(names(TopFive.rankTop(stats, 'minutes')), ['D', 'A', 'C', 'B']);
});

test('everything tied for 5th is listed, capped with a more_tied count', () => {
  const stats = new Map();
  ['A', 'B', 'C', 'D'].forEach((n, i) => stats.set(n, { name: n, plays: 100 - i, ms: 0 }));
  for (let i = 0; i < 9; i++) stats.set('T' + i, { name: 'T' + i, plays: 50, ms: 0 }); // 9-way tie at #5
  const top = TopFive.rankTop(stats, 'plays');
  assert.equal(top.items.length, 10);
  assert.equal(top.more_tied, 3);
  assert.ok(top.items.slice(4).every((i) => i.rank === 5 && i.tied));
});

test('a tie straddling #5 does not pull in #6+', () => {
  const stats = new Map();
  [10, 9, 8, 7, 6, 6, 6, 5].forEach((p, i) => stats.set('X' + i, { name: 'X' + i, plays: p, ms: 0 }));
  const top = TopFive.rankTop(stats, 'plays');
  assert.deepEqual(top.items.map((i) => i.rank), [1, 2, 3, 4, 5, 5, 5]);
});

test('identical items fall back to a stable name order', () => {
  const stats = new Map([
    ['b', { name: 'b', plays: 3, ms: 9 }],
    ['a', { name: 'a', plays: 3, ms: 9 }],
  ]);
  assert.deepEqual(names(TopFive.rankTop(stats, 'minutes')), ['a', 'b']);
});

/* ---------------- sparse / empty / incomplete years ---------------- */

test('history that starts after Nov 15 gives an empty Wrapped window', () => {
  const r = build(daily('2019-12-17', 10, 'A', 'a'));
  const y = r.years[2019];
  assert.equal(y.wrapped.flags.empty, true);
  assert.equal(y.wrapped.top, undefined);
  assert.equal(y.diff, null);
  assert.equal(y.full.flags.sparse, true);
  assert.equal(y.full.flags.starts_late, true);
  assert.equal(y.full.flags.ends_early, true); // export's last play is Dec 26
  assert.deepEqual(y.full.covered, ['2019-12-17', '2019-12-26']);
});

test('a year with plenty of plays is not sparse', () => {
  const r = build(daily('2024-01-01', 366, 'A', 'a').concat(daily('2024-01-01', 200, 'B', 'b')));
  assert.equal(r.years[2024].full.flags.sparse, false);
  assert.equal(r.years[2024].full.streaks.listening.days, 366);
});

test('incomplete current year is flagged and compared over the same span', () => {
  const records = daily('2025-01-01', 365, 'A', 'a').concat(daily('2026-01-01', 30, 'A', 'a'));
  const r = build(records, '2026-02-15');
  const w = r.years[2026].full;
  assert.equal(w.flags.ends_early, true);
  assert.equal(w.flags.in_progress, true);
  assert.equal(w.yoy.basis, 'same_span');
  assert.deepEqual(w.yoy.span, ['2025-01-01', '2025-01-30']);
  assert.equal(w.yoy.previous.plays, 30);
  assert.equal(w.yoy.current.plays, 30);
  // a finished year compares against the whole prior window
  assert.equal(r.years[2025].full.yoy, null); // no 2024 data
  assert.equal(r.years[2025].full.flags.in_progress, false);
});

test('same-span comparison clamps Feb 29 to Feb 28', () => {
  const records = daily('2023-01-01', 365, 'A', 'a').concat(daily('2024-01-01', 60, 'A', 'a')); // 2024 ends Feb 29
  const r = build(records, '2024-03-01');
  assert.deepEqual(r.years[2024].full.yoy.span, ['2023-01-01', '2023-02-28']);
});

test('discovery is only reliable with a full prior year of history', () => {
  const records = daily('2022-06-01', 10, 'Old', 'o')
    .concat(daily('2023-03-01', 5, 'Old', 'o'))
    .concat(daily('2024-03-01', 5, 'Old', 'o'))
    .concat(daily('2024-04-01', 5, 'New', 'n'));
  const r = build(records);
  assert.equal(r.years[2023].full.discovery.reliable, false);
  const d = r.years[2024].full.discovery;
  assert.equal(d.reliable, true);
  assert.equal(d.new_artists, 1);
  assert.equal(d.returning_artists, 1);
  assert.deepEqual(names(d.top_new), ['New']);
});

/* ---------------- other stats ---------------- */

test('top day, obsession and streaks', () => {
  const records = [
    ...daily('2024-05-01', 3, 'A', 'a'),
    rec('2024-05-02T13:00:00Z', 'B', 'b'),
    rec('2024-05-02T14:00:00Z', 'B', 'b'),
    rec('2024-05-02T15:00:00Z', 'B', 'b'),
    ...daily('2024-06-01', 2, 'A', 'a'),
  ];
  const w = build(records).years[2024].full;
  assert.equal(w.top_day.date, '2024-05-02');
  assert.equal(w.top_day.plays, 4);
  assert.deepEqual([w.obsession.name, w.obsession.plays], ['b', 3]);
  assert.deepEqual(w.streaks.listening, { days: 3, start: '2024-05-01', end: '2024-05-03' });
  assert.equal(w.streaks.artist.name, 'A');
});

test('longestRun handles gaps and month edges', () => {
  assert.deepEqual(TopFive.longestRun(['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-05']),
    { days: 3, start: '2024-02-28', end: '2024-03-01' });
  assert.deepEqual(TopFive.longestRun([]), { days: 0, start: null, end: null });
});

test('rank changes between windows are reported', () => {
  // A leads through Nov 15; B's December binge overtakes it in the full year
  const records = daily('2024-03-01', 10, 'A', 'a').concat(daily('2024-03-01', 5, 'B', 'b'), daily('2024-12-01', 10, 'B', 'b'));
  const y = build(records).years[2024];
  const rows = y.diff.categories.artists.plays;
  assert.equal(y.diff.changed, true);
  assert.deepEqual(rows.map((r) => [r.name, r.wrapped_rank, r.full_rank, r.status]), [
    ['A', 1, 2, 'down'], ['B', 2, 1, 'up'],
  ]);
});

test('personality picks the strongest trait', () => {
  // one artist, one song, on repeat at 2am -> loyalist / replayer / night owl
  const records = daily('2024-01-01', 40, 'A', 'a').map((r) => ({ ...r, ts: r.ts.replace('T12:', 'T08:') }));
  const p = build(records).years[2024].full.personality;
  assert.equal(p.key, 'replayer'); // 40 plays / 1 track / 4.5 = score 8.9
  assert.deepEqual(p.traits.map((t) => t.key), ['loyalist', 'night_owl']); // 1/0.2 = 5, 1/0.25 = 4
});

test('no records gives an empty result', () => {
  const r = build([]);
  assert.deepEqual(r.year_list, []);
  assert.equal(r.config.data_range, null);
});
