// Tests for js/saved.js's validation of saved entries. Run with: node --test
// (The IndexedDB read/write itself needs a browser; this covers what decides
// whether an old save is trusted.)

const test = require('node:test');
const assert = require('node:assert/strict');
const SavedData = require('../js/saved.js');

const rec = { ts: '2024-03-01T18:00:00Z', ms_played: 180000, master_metadata_track_name: 't', master_metadata_album_artist_name: 'a' };

test('a current-version save with records is usable', () => {
  const entry = { version: SavedData.SAVE_VERSION, savedAt: '2026-10-05T00:00:00Z', fileCount: 1, records: [rec] };
  assert.equal(SavedData.validate(entry), entry);
});

test('outdated, empty or malformed saves are rejected', () => {
  assert.equal(SavedData.validate(null), null);
  assert.equal(SavedData.validate(undefined), null);
  assert.equal(SavedData.validate({ version: SavedData.SAVE_VERSION + 1, records: [rec] }), null);
  assert.equal(SavedData.validate({ version: SavedData.SAVE_VERSION, records: [] }), null);
  assert.equal(SavedData.validate({ version: SavedData.SAVE_VERSION, records: 'nope' }), null);
});

test('without IndexedDB (Node, blocked storage) everything resolves instead of throwing', async () => {
  assert.equal(await SavedData.save([rec], 1), false);
  assert.equal(await SavedData.load(), null);
  assert.equal(await SavedData.clear(), false);
});
