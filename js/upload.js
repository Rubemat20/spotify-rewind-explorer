// Turns whatever the user dropped or selected (one or more .zip files, one
// or more loose .json files, or a folder) into the flat array of streaming
// records that aggregate.js expects. Nothing here ever leaves the browser --
// there is no fetch(), no upload endpoint, no network call at all.

const AUDIO_FILE_RE = /Streaming_History_Audio_.*\.json$/i;

// Keep only the fields aggregate.js actually reads, so a multi-year export
// (which can be 100MB+ of JSON) doesn't balloon into an even larger array of
// full objects once parsed.
function slimRecord(raw) {
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
// Returns { records, fileCount } after expanding any zips and reading every
// matching Streaming_History_Audio_*.json entry.
async function collectRecordsFromFiles(fileList, onProgress) {
  const files = Array.from(fileList);
  const records = [];
  let fileCount = 0;

  const zipFiles = files.filter((f) => /\.zip$/i.test(f.name));
  const jsonFiles = files.filter((f) => AUDIO_FILE_RE.test(f.name));

  if (!zipFiles.length && !jsonFiles.length) {
    throw new Error(
      "Couldn't find any Streaming_History_Audio_*.json files there. " +
      'Drop the .zip Spotify emailed you, or the "Spotify Extended Streaming History" folder from inside it.'
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
      'Found the files but no listening records inside them. Make sure this is the ' +
      '"Streaming History" export (audio), not the account-data or GDPR export.'
    );
  }

  return { records, fileCount };
}
