// "Top Five" by year: Full Year vs. Wrapped window.
//
// Pure aggregation, no DOM. app.js runs buildTopFive() once right after
// upload and it precomputes every year x both windows, so the view's
// toggle switches instantly.
//
// Two deliberate differences from aggregate.js:
//   - Local time, not UTC. "Jan 1", "11pm" and "Saturday" should mean the
//     listener's wall clock, the way Wrapped does, so timestamps are shifted
//     into the visitor's own time zone (Intl, per UTC hour, DST-aware).
//   - Only plays of 30s or more count, matching Wrapped's definition of a
//     stream. Shorter plays are kept around just for the skip rate.
//
// Everything lives inside one namespace object because aggregate.js and
// app.js share the global scope (and already define round1, dayKey, esc...).

const TopFive = (() => {
  // Last day (inclusive) of the Wrapped window, as [month, day]. Spotify says
  // Wrapped "captures your listening from January 1 until mid November"
  // (Wrapped 2025 methodology post), so mid-November is assumed every year.
  const WRAPPED_CUTOFF = [11, 15];
  const WRAPPED_EXCLUDES_INCOGNITO = true; // Private Session plays don't count toward Wrapped
  const MIN_MS = 30000;
  const TOP_N = 5;
  const MAX_LISTED = 10; // row cap when lots of items tie for the last place
  const SPARSE_MIN_PLAYS = 500;
  const SPARSE_MIN_ACTIVE_DAYS = 30;
  const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3]);
  const MORNING_HOURS = new Set([5, 6, 7, 8]);
  const CATEGORIES = ['artists', 'tracks', 'albums'];
  const METRICS = ['minutes', 'plays'];
  const WINDOWS = ['full', 'wrapped'];
  const SEP = '\u0000';

  // [key, name, blurb, metric, threshold] -- score = metric / threshold, a trait needs score >= 1.
  // Thresholds are set against a real multi-year export, where even a heavy
  // favorite rarely tops ~15% of a year's minutes.
  const PERSONALITIES = [
    ['loyalist',   'The Loyalist',   'A handful of artists got a big slice of your time.',  'top5_artist_share', 0.20],
    ['explorer',   'The Explorer',   'You kept finding new artists all year.',              'new_artist_share',  0.15],
    ['replayer',   'The Replayer',   'When you love a song, you play it into the ground.',  'plays_per_track',   4.5],
    ['night_owl',  'The Night Owl',  'A big share of your listening happens after 10pm.',   'night_share',       0.25],
    ['early_bird', 'The Early Bird', 'Mornings are when the music comes on.',               'morning_share',     0.20],
    ['curator',    'The Curator',    'You pick what plays; shuffle rarely gets a say.',     'curated_share',     0.80],
    ['shuffler',   'The Shuffler',   'You let shuffle drive.',                              'shuffle_share',     0.60],
    ['skipper',    'The Skipper',    "Quick to skip anything that isn't hitting.",          'skip_rate',         0.25],
  ];
  const FALLBACK_PERSONALITY = ['eclectic', 'The Eclectic', 'No single habit dominates your listening.'];

  /* ---------------- dates ---------------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateStr = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  // Streaks call this for the same few thousand dates over and over, so memoize.
  const dayNums = new Map();
  function dayNum(s) {
    let n = dayNums.get(s);
    if (n === undefined) {
      n = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
      dayNums.set(s, n);
    }
    return n;
  }
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  const minStr = (a, b) => (a < b ? a : b);
  const maxStr = (a, b) => (a > b ? a : b);

  // Clamps e.g. Feb 29 in a non-leap year to Feb 28.
  function safeDate(y, m, d) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return dateStr(y, m, Math.min(d, last));
  }

  function windowBounds(year, kind) {
    const end = kind === 'wrapped' ? safeDate(year, WRAPPED_CUTOFF[0], WRAPPED_CUTOFF[1]) : dateStr(year, 12, 31);
    return [dateStr(year, 1, 1), end];
  }

  // ts (ISO, UTC) -> local calendar fields. The UTC offset is looked up once
  // per UTC hour and cached, so 100k+ records cost a few hundred Intl calls.
  function makeLocalizer(timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const offsets = new Map();
    return function localize(ms) {
      const hourKey = Math.floor(ms / 3600000);
      let offset = offsets.get(hourKey);
      if (offset === undefined) {
        const p = {};
        for (const part of fmt.formatToParts(new Date(hourKey * 3600000))) p[part.type] = part.value;
        offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - hourKey * 3600000;
        offsets.set(hourKey, offset);
      }
      const d = new Date(ms + offset);
      return {
        date: dateStr(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        hour: d.getUTCHours(),
        weekday: (d.getUTCDay() + 6) % 7, // Monday=0, same as aggregate.js
      };
    };
  }

  /* ---------------- normalization ---------------- */
  // Slim upload records -> plays with local calendar fields, oldest first.
  // Doesn't touch the caller's objects (aggregate.js mutates its own copy).
  function normalize(records, timeZone) {
    const localize = makeLocalizer(timeZone);
    const out = [];
    for (const r of records) {
      if (!r || !r.ts || !r.master_metadata_track_name) continue;
      const ms = Date.parse(r.ts);
      if (Number.isNaN(ms)) continue;
      const artist = r.master_metadata_album_artist_name || 'Unknown Artist';
      out.push({
        t: ms,
        ...localize(ms),
        artist,
        track: r.master_metadata_track_name,
        album: r.master_metadata_album_album_name || r.master_metadata_track_name,
        ms: r.ms_played || 0,
        incognito: !!r.incognito_mode,
        shuffle: !!r.shuffle,
        skipped: !!r.skipped,
      });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  function inWindow(p, kind, start, end) {
    if (p.date < start || p.date > end) return false;
    return !(kind === 'wrapped' && WRAPPED_EXCLUDES_INCOGNITO && p.incognito);
  }

  /* ---------------- ranking ---------------- */
  // stats: Map<key, {name, artist?, plays, ms}>. The same maps get ranked
  // several times (top lists, Wrapped diff, year over year) and never change
  // after aggregation, so each sort is cached per map and metric.
  const sortCache = new WeakMap();
  function ordered(stats, by) {
    const [pk, sk] = by === 'plays' ? ['plays', 'ms'] : ['ms', 'plays'];
    let cached = sortCache.get(stats);
    if (!cached) { cached = {}; sortCache.set(stats, cached); }
    if (!cached[by]) {
      cached[by] = [...stats.entries()].sort((a, b) =>
        (b[1][pk] - a[1][pk]) || (b[1][sk] - a[1][sk]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }
    return [cached[by], pk];
  }

  // Map<key, rank> over every key. Equal primary values share a rank (1, 2, 2, 4).
  function rankPositions(stats, by) {
    const [rows, pk] = ordered(stats, by);
    const ranks = new Map();
    let rank = 0, prev = null;
    rows.forEach(([key, v], i) => {
      if (v[pk] !== prev) { rank = i + 1; prev = v[pk]; }
      ranks.set(key, rank);
    });
    return ranks;
  }

  // Top n by 'plays' or 'minutes'. Ties on the primary metric share a rank and
  // are listed in order of the other metric, then name. Everything tied with
  // the n-th place is included, up to `limit` rows; more_tied counts the rest.
  function rankTop(stats, by, n = TOP_N, limit = MAX_LISTED) {
    const [rows, pk] = ordered(stats, by);
    const picked = [];
    let rank = 0, prev = null;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][1];
      if (v[pk] !== prev) { rank = i + 1; prev = v[pk]; }
      if (rank > n) break;
      picked.push([rank, v]);
    }
    const perRank = new Map();
    for (const [r] of picked) perRank.set(r, (perRank.get(r) || 0) + 1);
    return {
      items: picked.slice(0, limit).map(([r, v]) => ({ ...publicItem(v), rank: r, tied: perRank.get(r) > 1 })),
      more_tied: Math.max(0, picked.length - limit),
    };
  }

  function publicItem(v) {
    const item = { name: v.name };
    if (v.artist !== undefined) item.artist = v.artist;
    item.plays = v.plays;
    item.minutes = Math.round(v.ms / 6000) / 10;
    return item;
  }

  /* ---------------- aggregation ---------------- */
  // Longest run of consecutive calendar days -> {days, start, end}.
  function longestRun(dates) {
    const sorted = [...dates].sort();
    let best = { days: 0, start: null, end: null };
    let runStart = null, prev = null;
    for (const d of sorted) {
      if (prev === null || daysBetween(prev, d) !== 1) runStart = d;
      const days = daysBetween(runStart, d) + 1;
      if (days > best.days) best = { days, start: runStart, end: d };
      prev = d;
    }
    return best;
  }

  // Runs once per play per map, so it only allocates for a key it hasn't seen.
  function bump(map, key, name, artist, ms) {
    let v = map.get(key);
    if (!v) {
      v = artist === undefined ? { name, plays: 0, ms: 0 } : { name, artist, plays: 0, ms: 0 };
      map.set(key, v);
    }
    v.plays += 1;
    v.ms += ms;
  }

  function firstSeenDates(plays) {
    const seen = new Map();
    for (const p of plays) {
      if (p.ms >= MIN_MS && !seen.has(p.artist)) seen.set(p.artist, p.date);
    }
    return seen;
  }

  // One window's plays (short plays included; only >= MIN_MS ones count).
  function aggregate(plays, start, end, firstSeen) {
    const agg = {
      start, end,
      starts: 0, skips: 0, plays: 0, ms: 0,
      artists: new Map(), tracks: new Map(), albums: new Map(),
      byDate: new Map(),          // date -> {plays, ms}
      trackByDate: new Map(),     // date -> Map(trackKey -> plays)
      artistDates: new Map(),     // artist -> Set(date)
      hours: new Array(24).fill(0), weekdays: new Array(7).fill(0), months: new Array(12).fill(0),
      shuffleMs: 0, nightMs: 0, morningMs: 0,
      newArtists: new Set(),
    };
    for (const p of plays) {
      agg.starts += 1;
      if (p.skipped) agg.skips += 1;
      if (p.ms < MIN_MS) continue;
      const ms = p.ms;
      const tkey = p.artist + SEP + p.track;
      agg.plays += 1;
      agg.ms += ms;
      bump(agg.artists, p.artist, p.artist, undefined, ms);
      bump(agg.tracks, tkey, p.track, p.artist, ms);
      bump(agg.albums, p.artist + SEP + p.album, p.album, p.artist, ms);
      bump(agg.byDate, p.date, p.date, undefined, ms);
      if (!agg.trackByDate.has(p.date)) agg.trackByDate.set(p.date, new Map());
      const dayTracks = agg.trackByDate.get(p.date);
      dayTracks.set(tkey, (dayTracks.get(tkey) || 0) + 1);
      if (!agg.artistDates.has(p.artist)) agg.artistDates.set(p.artist, new Set());
      agg.artistDates.get(p.artist).add(p.date);
      agg.hours[p.hour] += ms;
      agg.weekdays[p.weekday] += ms;
      agg.months[p.month - 1] += ms;
      if (p.shuffle) agg.shuffleMs += ms;
      if (NIGHT_HOURS.has(p.hour)) agg.nightMs += ms;
      if (MORNING_HOURS.has(p.hour)) agg.morningMs += ms;
      const seen = firstSeen.get(p.artist);
      if (seen && seen >= start && seen <= end) agg.newArtists.add(p.artist);
    }
    return agg;
  }

  const ratio = (a, b) => (b ? Math.round((a / b) * 10000) / 10000 : 0);
  const toMin = (ms) => Math.round(ms / 60000);

  function personality(agg, discoveryReliable) {
    if (!agg.plays) return null;
    const total = agg.ms;
    const top5 = [...agg.artists.values()].map((v) => v.ms).sort((a, b) => b - a).slice(0, 5);
    let newMs = 0;
    for (const a of agg.newArtists) newMs += agg.artists.get(a).ms;
    const metrics = {
      top5_artist_share: ratio(top5.reduce((s, x) => s + x, 0), total),
      new_artist_share: discoveryReliable ? ratio(newMs, total) : null,
      plays_per_track: Math.round((agg.plays / agg.tracks.size) * 100) / 100,
      night_share: ratio(agg.nightMs, total),
      morning_share: ratio(agg.morningMs, total),
      shuffle_share: ratio(agg.shuffleMs, total),
      curated_share: ratio(total - agg.shuffleMs, total),
      skip_rate: ratio(agg.skips, agg.starts),
    };
    const traits = [];
    for (const [key, name, blurb, metric, threshold] of PERSONALITIES) {
      const value = metrics[metric];
      if (value === null) continue;
      const score = value / threshold;
      if (score >= 1) traits.push({ key, name, blurb, score: Math.round(score * 100) / 100 });
    }
    traits.sort((a, b) => b.score - a.score);
    const primary = traits.length
      ? traits[0]
      : { key: FALLBACK_PERSONALITY[0], name: FALLBACK_PERSONALITY[1], blurb: FALLBACK_PERSONALITY[2], score: null };
    return { ...primary, traits: traits.slice(1, 3), metrics };
  }

  function summarize(agg, dataFirst, dataLast, today, year) {
    const { start, end } = agg;
    const covStart = maxStr(start, dataFirst), covEnd = minStr(end, dataLast);
    const coveredDays = covStart <= covEnd ? daysBetween(covStart, covEnd) + 1 : 0;
    const activeDays = agg.byDate.size;

    const flags = {
      empty: agg.plays === 0,
      sparse: agg.plays < SPARSE_MIN_PLAYS || activeDays < SPARSE_MIN_ACTIVE_DAYS,
      starts_late: dataFirst > start,   // history begins partway through the window
      ends_early: dataLast < end,       // export ends before the window does
      in_progress: today <= end,        // the window hasn't finished on the calendar yet
    };
    const out = { range: [start, end], covered: coveredDays ? [covStart, covEnd] : null, flags };
    if (flags.empty) return out;

    out.totals = {
      plays: agg.plays,
      minutes: toMin(agg.ms),
      active_days: activeDays,
      covered_days: coveredDays,
      avg_minutes_per_day: Math.round((agg.ms / 60000 / coveredDays) * 10) / 10,
      unique_artists: agg.artists.size,
      unique_tracks: agg.tracks.size,
      unique_albums: agg.albums.size,
      skip_rate: ratio(agg.skips, agg.starts),
      shuffle_share: ratio(agg.shuffleMs, agg.ms),
    };

    out.top = {};
    for (const cat of CATEGORIES) {
      out.top[cat] = {};
      for (const m of METRICS) out.top[cat][m] = rankTop(agg[cat], m);
    }

    let topDay = null;
    for (const [d, v] of agg.byDate) {
      if (!topDay || v.ms > topDay[1].ms || (v.ms === topDay[1].ms && v.plays > topDay[1].plays)) topDay = [d, v];
    }
    const dayTrack = maxTrackOfDay(agg.trackByDate.get(topDay[0]));
    out.top_day = {
      date: topDay[0], plays: topDay[1].plays, minutes: toMin(topDay[1].ms),
      top_track: { ...trackRef(agg, dayTrack[0]), plays: dayTrack[1] },
    };

    let obsession = null;
    for (const [d, tracks] of agg.trackByDate) {
      const [k, c] = maxTrackOfDay(tracks);
      if (!obsession || c > obsession.plays) obsession = { date: d, ...trackRef(agg, k), plays: c };
    }
    out.obsession = obsession;

    const hours = agg.hours.map(toMin), weekdays = agg.weekdays.map(toMin);
    out.clock = {
      hours, weekdays, months: agg.months.map(toMin),
      peak_hour: hours.indexOf(Math.max(...hours)),
      peak_weekday: weekdays.indexOf(Math.max(...weekdays)), // 0 = Monday
    };

    let bestArtist = null;
    for (const [a, dates] of agg.artistDates) {
      const run = longestRun(dates);
      if (!bestArtist || run.days > bestArtist.days ||
          (run.days === bestArtist.days && agg.artists.get(a).ms > agg.artists.get(bestArtist.name).ms)) {
        bestArtist = { name: a, ...run };
      }
    }
    out.streaks = { listening: longestRun(agg.byDate.keys()), artist: bestArtist };

    // "New artist" only means something with a full prior year of history behind it.
    const reliable = dataFirst <= dateStr(year - 1, 1, 1);
    const newStats = new Map();
    let newMs = 0;
    for (const a of agg.newArtists) {
      newStats.set(a, agg.artists.get(a));
      newMs += agg.artists.get(a).ms;
    }
    out.discovery = {
      reliable,
      new_artists: agg.newArtists.size,
      returning_artists: agg.artists.size - agg.newArtists.size,
      new_minutes_share: ratio(newMs, agg.ms),
      top_new: rankTop(newStats, 'minutes'),
    };

    out.personality = personality(agg, reliable);
    return out;
  }

  function maxTrackOfDay(tracks) {
    let best = null;
    for (const [k, c] of tracks) if (!best || c > best[1] || (c === best[1] && k < best[0])) best = [k, c];
    return best;
  }

  function trackRef(agg, tkey) {
    const v = agg.tracks.get(tkey);
    return { name: v.name, artist: v.artist };
  }

  /* ---------------- comparisons ---------------- */
  // How the Full Year top 5s differ from the Wrapped window's.
  function diffWindows(wrapped, full, afterCutoff, incognito) {
    const out = { changed: false, categories: {}, after_cutoff: afterCutoff, incognito_excluded: incognito };
    for (const cat of CATEGORIES) {
      out.categories[cat] = {};
      for (const m of METRICS) {
        const wRanks = rankPositions(wrapped[cat], m), fRanks = rankPositions(full[cat], m);
        const topKeys = (ranks) => [...ranks.entries()].filter(([, r]) => r <= TOP_N).map(([k]) => k);
        const keys = topKeys(wRanks);
        for (const k of topKeys(fRanks)) if (!keys.includes(k)) keys.push(k);
        out.categories[cat][m] = keys.map((k) => {
          const wr = wRanks.has(k) ? wRanks.get(k) : null;
          const fr = fRanks.has(k) ? fRanks.get(k) : null;
          const inW = wr !== null && wr <= TOP_N, inF = fr !== null && fr <= TOP_N;
          let status;
          if (inW && !inF) status = 'dropped';       // in the Wrapped top 5, out of the Full Year's
          else if (inF && !inW) status = 'entered';  // only made the Full Year top 5
          else if (wr === fr) status = 'same';
          else status = fr < wr ? 'up' : 'down';
          if (status !== 'same') out.changed = true;
          // Every Wrapped play is also a Full Year play, so full[cat] always has k.
          return { ...publicItem(full[cat].get(k)), wrapped_rank: wr, full_rank: fr, status };
        });
      }
    }
    return out;
  }

  function totalsBrief(agg) {
    return { plays: agg.plays, minutes: toMin(agg.ms), unique_artists: agg.artists.size, new_artists: agg.newArtists.size };
  }

  function yearOverYear(cur, prev, prevFlags, basis) {
    if (!prev || !prev.plays) return null;
    const prevRanks = rankPositions(prev.artists, 'minutes');
    return {
      prev_year: +prev.start.slice(0, 4),
      basis, // 'same_window', or 'same_span' when this window is incomplete
      span: [prev.start, prev.end],
      prev_sparse: !!(prevFlags && prevFlags.sparse),
      current: totalsBrief(cur),
      previous: totalsBrief(prev),
      top_artists: rankTop(cur.artists, 'minutes').items.map((it) => ({
        name: it.name, rank: it.rank, prev_rank: prevRanks.has(it.name) ? prevRanks.get(it.name) : null,
      })),
    };
  }

  function brief(plays) {
    let n = 0, ms = 0;
    for (const p of plays) if (p.ms >= MIN_MS) { n += 1; ms += p.ms; }
    return { plays: n, minutes: toMin(ms) };
  }

  /* ---------------- entry point ---------------- */
  // records: slim records from upload.js.
  // opts.timeZone defaults to the browser's; opts.today ('YYYY-MM-DD', local) to now.
  function buildTopFive(records, opts = {}) {
    const timeZone = opts.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const today = opts.today || makeLocalizer(timeZone)(Date.now()).date;
    const plays = normalize(records, timeZone);
    const config = {
      time_zone: timeZone,
      today,
      wrapped_cutoff: WRAPPED_CUTOFF.slice(),
      wrapped_excludes_incognito: WRAPPED_EXCLUDES_INCOGNITO,
      top_n: TOP_N,
      min_seconds: MIN_MS / 1000,
      data_range: plays.length ? [plays[0].date, plays[plays.length - 1].date] : null,
    };
    const result = { config, years: {}, year_list: [] };
    if (!plays.length) return result;

    const [dataFirst, dataLast] = config.data_range;
    const firstSeen = firstSeenDates(plays);
    const byYear = new Map();
    for (const p of plays) {
      if (!byYear.has(p.year)) byYear.set(p.year, []);
      byYear.get(p.year).push(p);
    }

    const aggFor = (year, kind, endOverride) => {
      const [start, wEnd] = windowBounds(year, kind);
      const end = endOverride || wEnd;
      const window = (byYear.get(year) || []).filter((p) => inWindow(p, kind, start, end));
      return aggregate(window, start, end, firstSeen);
    };

    const aggs = new Map(), flags = new Map();
    const years = [...byYear.keys()].sort((a, b) => a - b);
    for (const year of years) {
      const entry = {};
      for (const kind of WINDOWS) {
        const agg = aggFor(year, kind);
        aggs.set(year + kind, agg);
        entry[kind] = summarize(agg, dataFirst, dataLast, today, year);
        flags.set(year + kind, entry[kind].flags);
      }

      for (const kind of WINDOWS) {
        const w = entry[kind], prevYear = year - 1;
        if (w.flags.empty || !byYear.has(prevYear)) { w.yoy = null; continue; }
        if (w.flags.ends_early) {
          // Compare like with like: the same Jan 1 -> data-end span of the prior year.
          const prev = aggFor(prevYear, kind, safeDate(prevYear, +dataLast.slice(5, 7), +dataLast.slice(8, 10)));
          w.yoy = yearOverYear(aggs.get(year + kind), prev, flags.get(prevYear + kind), 'same_span');
        } else {
          w.yoy = yearOverYear(aggs.get(year + kind), aggs.get(prevYear + kind), flags.get(prevYear + kind), 'same_window');
        }
      }

      const [wStart, wEnd] = windowBounds(year, 'wrapped');
      const yearPlays = byYear.get(year);
      entry.diff = entry.wrapped.flags.empty ? null : diffWindows(
        aggs.get(year + 'wrapped'), aggs.get(year + 'full'),
        brief(yearPlays.filter((p) => p.date > wEnd)),
        WRAPPED_EXCLUDES_INCOGNITO ? brief(yearPlays.filter((p) => p.incognito && p.date >= wStart && p.date <= wEnd)) : null,
      );
      result.years[year] = entry;
    }
    result.year_list = years.slice().reverse();
    return result;
  }

  return { buildTopFive, rankTop, rankPositions, longestRun, windowBounds, makeLocalizer, WRAPPED_CUTOFF, TOP_N };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TopFive;
