// Port of the Python aggregation pipeline (aggregate_all_artists.py) to JavaScript.
// Runs entirely client-side: takes raw Spotify Extended Streaming History
// records and produces the exact same {index, artists} shape the dashboard
// rendering code (app.js) consumes.
//
// All date math uses the UTC getters (getUTCFullYear, getUTCDay, ...) because
// the source timestamps are ISO 8601 with a trailing "Z" (UTC) and the
// original Python pipeline read the numbers as-is (naive parse of a
// Zulu-suffixed string), never converting to local time. Mixing in local-time
// getters here would silently shift every bucket.

const MIN_PLAYS = 3;

function simplifyPlatform(p) {
  const s = (p || '').toLowerCase();
  if (s.includes('android')) return 'Android';
  if (s.includes('windows')) return 'Windows';
  if (s.includes('amazon') || s.includes('echo')) return 'Amazon Echo';
  if (s.includes('ios') || s.includes('iphone') || s.includes('ipad')) return 'iOS';
  if (s.includes('web_player')) return 'Web player';
  if (s.includes('os x') || s.includes('mac')) return 'Mac';
  return 'Other';
}

function dayPart(hour) {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

// Monday=0 .. Sunday=6, matching Python's datetime.weekday().
function isoWeekday(date) {
  return (date.getUTCDay() + 6) % 7;
}

function eraName(album) {
  let a = album;
  const colon = a.indexOf(':');
  if (colon !== -1) a = a.slice(0, colon);
  a = a.replace(/\(Taylor.s Version\)/gi, '');
  a = a.replace(/Platinum Edition/gi, '');
  a = a.replace(/-\s*Big Machine Radio Release Special/gi, '');
  a = a.replace(/\(Deluxe[^)]*\)/gi, '');
  a = a.replace(/\(3am Edition\)/gi, '');
  a = a.replace(/\([^)]*Edition\)/gi, '');
  return a.split(/\s+/).filter(Boolean).join(' ').replace(/^[\s-]+|[\s-]+$/g, '');
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dayKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function monthRange(start, end) {
  // start/end are [year, month(1-12)] pairs
  let [y, m] = start;
  const [ey, em] = end;
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function mostCommon(map, n) {
  // map: Map<key, count> -> [[key, count], ...] sorted desc, top n (or all if n omitted)
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return n ? rows.slice(0, n) : rows;
}

function friendlyDate(date) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')}, ${date.getUTCFullYear()}`;
}

function friendlyMonth(date) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function aggregateArtist(records) {
  for (const r of records) {
    r._dt = new Date(r.ts);
    r._track = r.master_metadata_track_name;
    r._albumRaw = r.master_metadata_album_album_name;
  }

  // ---- single/album de-duplication: fold a single's plays into whichever
  // candidate album (by raw name) is bigger overall, same heuristic as the
  // individual Rewind pages. ----
  const rawAlbumPlays = new Map();
  const rawAlbumTracks = new Map(); // album -> Set(track)
  for (const r of records) {
    rawAlbumPlays.set(r._albumRaw, (rawAlbumPlays.get(r._albumRaw) || 0) + 1);
    if (!rawAlbumTracks.has(r._albumRaw)) rawAlbumTracks.set(r._albumRaw, new Set());
    rawAlbumTracks.get(r._albumRaw).add(r._track);
  }
  const trackCandidateAlbums = new Map(); // track -> Set(album)
  for (const r of records) {
    if (!trackCandidateAlbums.has(r._track)) trackCandidateAlbums.set(r._track, new Set());
    trackCandidateAlbums.get(r._track).add(r._albumRaw);
  }
  const canonicalAlbumForTrack = new Map();
  for (const [track, albumSet] of trackCandidateAlbums) {
    const ranked = [...albumSet].sort((a, b) => {
      const playsA = rawAlbumPlays.get(a), playsB = rawAlbumPlays.get(b);
      if (playsA !== playsB) return playsB - playsA;
      const tracksA = rawAlbumTracks.get(a).size, tracksB = rawAlbumTracks.get(b).size;
      if (tracksA !== tracksB) return tracksB - tracksA;
      return a < b ? 1 : a > b ? -1 : 0; // reverse=True tiebreak
    });
    canonicalAlbumForTrack.set(track, ranked[0]);
  }
  for (const r of records) {
    r._album = canonicalAlbumForTrack.get(r._track);
  }

  let first = records[0]._dt, last = records[0]._dt;
  for (const r of records) {
    if (r._dt < first) first = r._dt;
    if (r._dt > last) last = r._dt;
  }

  let start = [first.getUTCFullYear(), first.getUTCMonth() + 1];
  let end = [last.getUTCFullYear(), last.getUTCMonth() + 1];
  // pad to a minimum 3-month window so the line chart never divides by (n-1)==0
  while (monthRange(start, end).length < 3) {
    let [sy, sm] = start;
    sm -= 1;
    if (sm < 1) { sm = 12; sy -= 1; }
    start = [sy, sm];
    if (monthRange(start, end).length < 3) {
      let [ey, em] = end;
      em += 1;
      if (em > 12) { em = 1; ey += 1; }
      end = [ey, em];
    }
  }
  const months = monthRange(start, end);

  const monthlyPlays = new Map();
  const monthlyMinutes = new Map();
  const monthlyReleaseCounts = new Map(); // month -> Map(release -> count)
  for (const r of records) {
    const key = monthKey(r._dt);
    monthlyPlays.set(key, (monthlyPlays.get(key) || 0) + 1);
    monthlyMinutes.set(key, (monthlyMinutes.get(key) || 0) + r.ms_played / 60000);
    const era = eraName(r._album);
    if (!monthlyReleaseCounts.has(key)) monthlyReleaseCounts.set(key, new Map());
    const mrc = monthlyReleaseCounts.get(key);
    mrc.set(era, (mrc.get(era) || 0) + 1);
  }
  const monthlySeries = months.map((mo) => {
    const mrc = monthlyReleaseCounts.get(mo);
    let dominant = null;
    if (mrc && mrc.size) dominant = mostCommon(mrc, 1)[0][0];
    return {
      month: mo,
      plays: monthlyPlays.get(mo) || 0,
      minutes: round1(monthlyMinutes.get(mo) || 0),
      dominant_release: dominant,
    };
  });

  const yearlyPlays = new Map();
  const yearlyMinutes = new Map();
  for (const r of records) {
    const key = String(r._dt.getUTCFullYear());
    yearlyPlays.set(key, (yearlyPlays.get(key) || 0) + 1);
    yearlyMinutes.set(key, (yearlyMinutes.get(key) || 0) + r.ms_played / 60000);
  }
  const yearlySeries = [...yearlyPlays.keys()].sort().map((y) => ({
    year: y, plays: yearlyPlays.get(y), minutes: round1(yearlyMinutes.get(y)),
  }));

  const dowCounts = new Map();
  for (const r of records) {
    const d = isoWeekday(r._dt);
    dowCounts.set(d, (dowCounts.get(d) || 0) + 1);
  }
  const dowLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowSeries = dowLabels.map((label, i) => ({ day: label, plays: dowCounts.get(i) || 0 }));

  const daypartCounts = new Map();
  for (const r of records) {
    const p = dayPart(r._dt.getUTCHours());
    daypartCounts.set(p, (daypartCounts.get(p) || 0) + 1);
  }
  const daypartOrder = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const daypartSeries = daypartOrder.map((p) => ({ part: p, plays: daypartCounts.get(p) || 0 }));

  const trackCounts = new Map();
  const trackMinutes = new Map();
  for (const r of records) {
    trackCounts.set(r._track, (trackCounts.get(r._track) || 0) + 1);
    trackMinutes.set(r._track, (trackMinutes.get(r._track) || 0) + r.ms_played / 60000);
  }
  const topTracks = mostCommon(trackCounts, 12).map(([t, c]) => ({
    track: t,
    plays: c,
    minutes: round1(trackMinutes.get(t)),
    album: canonicalAlbumForTrack.get(t),
    release: eraName(canonicalAlbumForTrack.get(t)),
  }));

  const albumMinutes = new Map();
  const albumPlays = new Map();
  for (const r of records) {
    albumMinutes.set(r._album, (albumMinutes.get(r._album) || 0) + r.ms_played / 60000);
    albumPlays.set(r._album, (albumPlays.get(r._album) || 0) + 1);
  }
  const albumSeriesAll = [...albumMinutes.entries()]
    .map(([a, m]) => ({ album: a, plays: albumPlays.get(a), minutes: round1(m), release: eraName(a) }))
    .sort((x, y) => y.minutes - x.minutes);
  const TOP_N_ALBUMS = 14;
  const albumSeries = albumSeriesAll.slice(0, TOP_N_ALBUMS);
  const rest = albumSeriesAll.slice(TOP_N_ALBUMS);
  let restSummary = null;
  if (rest.length) {
    restSummary = {
      count: rest.length,
      plays: rest.reduce((s, a) => s + a.plays, 0),
      minutes: round1(rest.reduce((s, a) => s + a.minutes, 0)),
    };
  }

  const eraMembers = new Map(); // era -> Set(album)
  for (const a of albumSeriesAll) {
    const era = eraName(a.album);
    if (!eraMembers.has(era)) eraMembers.set(era, new Set());
    eraMembers.get(era).add(a.album);
  }
  const hasEraGrouping = [...eraMembers.values()].some((members) => members.size > 1);

  let erasSeries = null;
  if (hasEraGrouping) {
    const eraMinutes = new Map();
    const eraPlays = new Map();
    for (const r of records) {
      const era = eraName(r._album);
      eraMinutes.set(era, (eraMinutes.get(era) || 0) + r.ms_played / 60000);
      eraPlays.set(era, (eraPlays.get(era) || 0) + 1);
    }
    erasSeries = [...eraMinutes.entries()]
      .map(([e, m]) => ({ era: e, plays: eraPlays.get(e), minutes: round1(m), album_count: eraMembers.get(e).size }))
      .sort((x, y) => y.minutes - x.minutes)
      .slice(0, 12);
  }

  const releasesForBand = hasEraGrouping
    ? erasSeries.slice(0, 6).map((e) => ({ name: e.era, plays: e.plays, minutes: e.minutes }))
    : albumSeriesAll.slice(0, 6).map((a) => ({ name: a.album, plays: a.plays, minutes: a.minutes }));

  const mid = new Date((first.getTime() + last.getTime()) / 2);
  const firstDays = Math.max(Math.floor((mid.getTime() - first.getTime()) / 86400000), 1);
  const secondDays = Math.max(Math.floor((last.getTime() - mid.getTime()) / 86400000), 1);

  function trend(entitiesFirst, entitiesSecond, minTotal) {
    const keys = new Set([...entitiesFirst.keys(), ...entitiesSecond.keys()]);
    const rows = [];
    for (const k of keys) {
      const f = entitiesFirst.get(k) || 0;
      const s = entitiesSecond.get(k) || 0;
      if (f === 0 || s === 0) continue;
      if (f + s < minTotal) continue;
      const rate1 = (f / firstDays) * 30;
      const rate2 = (s / secondDays) * 30;
      const ratio = (rate2 + 0.1) / (rate1 + 0.1);
      rows.push({ name: k, first_plays: f, second_plays: s, ratio: Math.round(ratio * 100) / 100 });
    }
    rows.sort((a, b) => b.ratio - a.ratio);
    return rows;
  }

  const trackFirst = new Map(), trackSecond = new Map();
  const albumFirst = new Map(), albumSecond = new Map();
  for (const r of records) {
    if (r._dt < mid) {
      trackFirst.set(r._track, (trackFirst.get(r._track) || 0) + 1);
      albumFirst.set(r._album, (albumFirst.get(r._album) || 0) + 1);
    } else {
      trackSecond.set(r._track, (trackSecond.get(r._track) || 0) + 1);
      albumSecond.set(r._album, (albumSecond.get(r._album) || 0) + 1);
    }
  }
  const trackMinTotal = Math.max(6, Math.round(records.length * 0.006));
  const albumMinTotal = Math.max(10, Math.round(records.length * 0.01));
  const trackTrendRows = trend(trackFirst, trackSecond, trackMinTotal);
  const albumTrendRows = trend(albumFirst, albumSecond, albumMinTotal);

  function splitRisingCooling(rows) {
    const rising = rows.filter((r) => r.ratio > 1.05).slice(0, 5);
    const coolingCandidates = rows.filter((r) => r.ratio < 0.95);
    const cooling = coolingCandidates.slice().reverse().slice(0, 5);
    return [rising, cooling];
  }
  const [risingTracks, coolingTracks] = splitRisingCooling(trackTrendRows);
  const [risingAlbums, coolingAlbums] = splitRisingCooling(albumTrendRows);
  const hasTrendData = risingTracks.length + coolingTracks.length >= 4;

  let shuffleTrue = 0;
  for (const r of records) if (r.shuffle) shuffleTrue += 1;
  const totalPlays = records.length;
  const shufflePct = round1((shuffleTrue / totalPlays) * 100);

  const platformCounts = new Map();
  for (const r of records) {
    const p = simplifyPlatform(r.platform);
    platformCounts.set(p, (platformCounts.get(p) || 0) + 1);
  }
  const [topPlatform, topPlatformCount] = mostCommon(platformCounts, 1)[0];

  const dayCounts = new Map();
  for (const r of records) {
    const k = dayKey(r._dt);
    dayCounts.set(k, (dayCounts.get(k) || 0) + 1);
  }
  const [peakDayRaw, peakDayCount] = mostCommon(dayCounts, 1)[0];
  const [py, pm, pd] = peakDayRaw.split('-').map(Number);
  const peakDay = friendlyDate(new Date(Date.UTC(py, pm - 1, pd)));

  let firstRec = records[0];
  for (const r of records) if (r._dt < firstRec._dt) firstRec = r;

  let skips = 0;
  for (const r of records) if (r.skipped) skips += 1;

  const summary = {
    total_plays: totalPlays,
    total_minutes: round1(records.reduce((s, r) => s + r.ms_played, 0) / 60000),
    unique_tracks: trackCounts.size,
    unique_albums: albumSeriesAll.length,
    first_listen: friendlyDate(first),
    last_listen: friendlyDate(last),
    first_listen_month: friendlyMonth(first),
    skips,
    skip_rate: round1((skips / totalPlays) * 100),
    played_through_rate: round1(100 - (skips / totalPlays) * 100),
    top_track: topTracks[0].track,
    top_track_plays: topTracks[0].plays,
    first_track: firstRec._track,
    first_track_album: firstRec._album,
    peak_day: peakDay,
    peak_day_count: peakDayCount,
    shuffle_pct: shufflePct,
    top_platform: topPlatform,
    top_platform_count: topPlatformCount,
    has_era_grouping: hasEraGrouping,
    has_trend_data: hasTrendData,
  };

  return {
    summary,
    monthly: monthlySeries,
    yearly: yearlySeries,
    dow: dowSeries,
    daypart: daypartSeries,
    top_tracks: topTracks,
    albums: albumSeries,
    albums_rest: restSummary,
    eras: erasSeries,
    releases_for_band: releasesForBand,
    rising_tracks: risingTracks,
    cooling_tracks: coolingTracks,
    rising_albums: risingAlbums,
    cooling_albums: coolingAlbums,
  };
}

// records: flat array of raw Spotify streaming history objects.
// onProgress(phase, done, total): optional progress callback.
function aggregateAllArtists(records, onProgress) {
  const recordsByArtist = new Map();
  for (const r of records) {
    const a = r.master_metadata_album_artist_name;
    if (!a) continue;
    if (!recordsByArtist.has(a)) recordsByArtist.set(a, []);
    recordsByArtist.get(a).push(r);
  }

  const artists = {};
  const index = [];
  let done = 0;
  const total = recordsByArtist.size;
  for (const [artist, recs] of recordsByArtist) {
    done += 1;
    if (onProgress && done % 100 === 0) onProgress('aggregating', done, total);
    if (recs.length < MIN_PLAYS) continue;
    const agg = aggregateArtist(recs);
    artists[artist] = agg;
    index.push({ name: artist, plays: agg.summary.total_plays, minutes: agg.summary.total_minutes });
  }
  index.sort((a, b) => b.minutes - a.minutes);
  return { index, artists };
}
