// Turns whatever the user dropped or selected (one or more .zip files, one
// or more loose .json files, or a folder) into the flat array of streaming
// records that aggregate.js expects. Nothing here ever leaves the browser --
// there is no fetch(), no upload endpoint, no network call at all.

// Extended export: Streaming_History_Audio_*.json. Basic account-data export:
// StreamingHistory_music_*.json (or StreamingHistory0.json in pre-2023
// exports, before podcasts were split out). Podcast/video files never match.
const AUDIO_FILE_RE = /Streaming_?History(_Audio_|_music_|\d).*\.json$/i;

// Keep only the fields aggregate.js actually reads, so a multi-year export
// (which can be 100MB+ of JSON) doesn't balloon into an even larger array of
// full objects once parsed.
function slimRecord(raw) {
  if (raw && raw.endTime) return slimBasicRecord(raw);
  if (!raw || !raw.ts || !raw.master_metadata_track_name || !raw.master_metadata_album_artist_name) {
    return null; // podcast/audiobook rows and the occasional null-track row
  }
  return {
    ts: raw.ts,
    ms_played: raw.ms_played || 0,
    master_metadata_track_name: raw.master_metadata_track_name,
    master_metadata_album_artist_name: raw.master_metadata_album_artist_name,
    master_metadata_album_album_name: raw.master_metadata_album_album_name || raw.master_metadata_track_name,
    skipped: !!raw.skipped,
    shuffle: !!raw.shuffle,
    platform: raw.platform || '',
    extended: true,
  };
}

// Basic export rows: { endTime: "2025-09-13 13:51", artistName, trackName,
// msPlayed }. endTime is UTC (like the extended "ts") but minute-precision and
// zone-less, so pin it to Z. There's no album, skip, shuffle or platform info
// -- aggregate.js leaves those stats out rather than faking them.
function slimBasicRecord(raw) {
  if (!raw.artistName || !raw.trackName) return null; // podcast rows
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(raw.endTime);
  if (!m) return null;
  return {
    ts: `${m[1]}T${m[2]}:00Z`,
    ms_played: raw.msPlayed || 0,
    master_metadata_track_name: raw.trackName,
    master_metadata_album_artist_name: raw.artistName,
    master_metadata_album_album_name: null,
    skipped: false,
    shuffle: false,
    platform: '',
    extended: false,
  };
}

function parseJsonText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const raw of data) {
    const slim = slimRecord(raw);
    if (slim) out.push(slim);
  }
  return out;
}

// fileList: FileList or File[] from an <input> or a drop event.
// Returns { records, fileCount, extended } after expanding any zips and reading
// every matching streaming history entry.
async function collectRecordsFromFiles(fileList, onProgress) {
  const files = Array.from(fileList);
  const records = [];
  let fileCount = 0;

  const zipFiles = files.filter((f) => /\.zip$/i.test(f.name));
  const jsonFiles = files.filter((f) => AUDIO_FILE_RE.test(f.name));

  if (!zipFiles.length && !jsonFiles.length) {
    throw new Error(
      "Couldn't find any streaming history files there. " +
      'Drop the .zip Spotify emailed you, or the "Spotify Extended Streaming History" / ' +
      '"Spotify Account Data" folder from inside it.'
    );
  }

  for (const zipFile of zipFiles) {
    if (onProgress) onProgress(`Reading ${zipFile.name}…`);
    const zip = await JSZip.loadAsync(zipFile);
    const entries = Object.values(zip.files).filter((e) => !e.dir && AUDIO_FILE_RE.test(e.name));
    for (const entry of entries) {
      const text = await entry.async('string');
      const recs = parseJsonText(text);
      for (const r of recs) records.push(r);
      fileCount += 1;
      if (onProgress) onProgress(`Read ${fileCount} file${fileCount === 1 ? '' : 's'}…`);
    }
  }

  for (const jsonFile of jsonFiles) {
    if (onProgress) onProgress(`Reading ${jsonFile.name}…`);
    const text = await jsonFile.text();
    const recs = parseJsonText(text);
    for (const r of recs) records.push(r);
    fileCount += 1;
    if (onProgress) onProgress(`Read ${fileCount} file${fileCount === 1 ? '' : 's'}…`);
  }

  if (!records.length) {
    throw new Error(
      'Found the files but no music listening records inside them. Make sure the ' +
      'export includes StreamingHistory_music_*.json or Streaming_History_Audio_*.json files.'
    );
  }

  // The basic export only covers the last year, which the extended export
  // already includes -- if both were dropped, keep just the extended rows so
  // nothing is counted twice.
  const extended = records.some((r) => r.extended);
  if (extended && !records.every((r) => r.extended)) {
    return { records: records.filter((r) => r.extended), fileCount, extended };
  }
  return { records, fileCount, extended };
}
