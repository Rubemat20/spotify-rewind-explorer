// Optional "Remember on this device": keeps the slimmed records from
// upload.js in this browser's own IndexedDB so a refresh doesn't mean a
// re-upload. Nothing here touches the network -- the data stays in this
// browser's storage until "Forget my data" deletes it.
//
// Records are saved rather than the finished aggregates, so a later version
// of aggregate.js / topfive.js still works from an old save. If the record
// shape itself ever changes (upload.js slimRecord), bump SAVE_VERSION and old
// saves are ignored and deleted instead of misread.
//
// Every function resolves rather than throws: private windows, blocked site
// data, or a full disk just mean "nothing saved".

const SavedData = (() => {
  const DB_NAME = 'rewind-explorer';
  const STORE = 'saved';
  const KEY = 'history';
  const SAVE_VERSION = 1;

  function open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function run(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    }));
  }

  // A saved entry is usable only if it's the current version and holds records.
  function validate(entry) {
    if (!entry || entry.version !== SAVE_VERSION || !Array.isArray(entry.records) || !entry.records.length) return null;
    return entry;
  }

  // Call before aggregateAllArtists(): it adds fields to the record objects,
  // and IndexedDB copies the records at the moment put() is called.
  function save(records, fileCount) {
    const entry = { version: SAVE_VERSION, savedAt: new Date().toISOString(), fileCount, records };
    return run('readwrite', (store) => store.put(entry, KEY))
      .then(() => true)
      .catch((err) => { console.warn('[rewind] could not save data on this device', err); return false; });
  }

  // -> {records, fileCount, savedAt} or null
  function load() {
    return run('readonly', (store) => store.get(KEY))
      .then((entry) => {
        const ok = validate(entry);
        if (!ok && entry) clear(); // outdated or broken save: drop it
        return ok;
      })
      .catch(() => null);
  }

  function clear() {
    return run('readwrite', (store) => store.delete(KEY)).then(() => true).catch(() => false);
  }

  return { save, load, clear, validate, SAVE_VERSION };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SavedData;
