/**
 * Pokerkasse – Datenhaltung.
 *
 * Die Daten liegen doppelt auf dem Gerät:
 *   1. IndexedDB   – der eigentliche Speicher, grosszuegig und dauerhaft
 *   2. localStorage – zusaetzliche Kopie, sofort beim Start lesbar
 * Faellt einer der beiden aus (Privatmodus, geloeschte Website-Daten), springt
 * der andere ein. Zusaetzlich werden automatische Sicherungen aufbewahrt,
 * aus denen sich ein frueherer Stand wiederherstellen laesst.
 */
(function (root) {
  'use strict';

  var LS_KEY = 'pokerkasse.v1';
  var LS_EXPORT = 'pokerkasse.lastExport';
  var DB_NAME = 'pokerkasse';
  var DB_VERSION = 1;
  var KV = 'kv';
  var SNAPS = 'snapshots';
  var MAX_SNAPS = 12;
  var SNAP_INTERVAL = 20 * 3600 * 1000;   // hoechstens eine Tagessicherung

  var dbPromise = null;

  /* ------------------------------------------------------------ IndexedDB */

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!root.indexedDB) return resolve(null);
      var req;
      try { req = root.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return resolve(null); }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
        if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
      // Safari im Privatmodus antwortet gelegentlich gar nicht.
      setTimeout(function () { resolve(null); }, 3000);
    });
    return dbPromise;
  }

  /** Fuehrt eine Transaktion aus und liefert das Ergebnis, oder null bei Fehlern. */
  function run(storeName, mode, fn) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var t, req;
        try { t = db.transaction(storeName, mode); } catch (e) { return resolve(null); }
        try { req = fn(t.objectStore(storeName)); } catch (e) { return resolve(null); }
        t.oncomplete = function () { resolve(req ? req.result : true); };
        t.onerror = function () { resolve(null); };
        t.onabort = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  /* ---------------------------------------------------------- localStorage */

  function readLs() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeLs(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
  }

  /* =================================================================== API */

  var Store = {

    /**
     * Liest den Stand aus beiden Speichern und nimmt den neueren. Fehlt er in
     * einem, wird er dort beim naechsten Speichern wieder ergaenzt.
     */
    load: function () {
      var ls = readLs();
      return run(KV, 'readonly', function (s) { return s.get('state'); }).then(function (idb) {
        var pick = ls, source = ls ? 'localStorage' : 'leer';
        if (idb && (!ls || (idb.updatedAt || 0) > (ls.updatedAt || 0))) {
          pick = idb;
          source = 'IndexedDB';
        }
        return { data: pick, source: source, hadIdb: !!idb, hadLs: !!ls };
      });
    },

    /**
     * Schreibt in beide Speicher. Das Ergebnis sagt, ob mindestens einer
     * erfolgreich war – nur dann sind die Daten wirklich gesichert.
     */
    save: function (state) {
      state.updatedAt = Date.now();
      var ls = writeLs(state);
      var copy;
      try { copy = JSON.parse(JSON.stringify(state)); } catch (e) { copy = null; }
      return (copy ? run(KV, 'readwrite', function (s) { return s.put(copy, 'state'); })
                   : Promise.resolve(null))
        .then(function (idb) { return { ok: ls || idb !== null, localStorage: ls, indexedDB: idb !== null }; });
    },

    /* ------------------------------------------------------- Sicherungen */

    /** Legt eine Sicherung an und wirft die aeltesten ueber MAX_SNAPS weg. */
    snapshot: function (state, reason) {
      var copy;
      try { copy = JSON.parse(JSON.stringify(state)); } catch (e) { return Promise.resolve(null); }
      var snap = {
        id: 'snap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        ts: Date.now(),
        reason: reason || '',
        players: (state.players || []).length,
        events: (state.events || []).length,
        data: copy
      };
      return run(SNAPS, 'readwrite', function (s) { return s.put(snap); })
        .then(function (res) { return res === null ? null : Store.prune().then(function () { return snap.id; }); });
    },

    /** Sicherungen, neueste zuerst (ohne die Daten selbst, nur die Eckdaten). */
    list: function () {
      return run(SNAPS, 'readonly', function (s) { return s.getAll(); }).then(function (all) {
        if (!all) return null;
        return all.sort(function (a, b) { return b.ts - a.ts; }).map(function (s) {
          return { id: s.id, ts: s.ts, reason: s.reason, players: s.players, events: s.events };
        });
      });
    },

    get: function (id) {
      return run(SNAPS, 'readonly', function (s) { return s.get(id); })
        .then(function (s) { return s ? s.data : null; });
    },

    prune: function () {
      return Store.list().then(function (all) {
        if (!all || all.length <= MAX_SNAPS) return null;
        var alt = all.slice(MAX_SNAPS);
        return Promise.all(alt.map(function (s) {
          return run(SNAPS, 'readwrite', function (st) { return st.delete(s.id); });
        }));
      });
    },

    /** Legt hoechstens einmal pro Tag automatisch eine Sicherung an. */
    autoSnapshot: function (state) {
      if (!state || (!state.players.length && !state.events.length)) return Promise.resolve(null);
      return Store.list().then(function (all) {
        if (all === null) return null;
        if (all.length && Date.now() - all[0].ts < SNAP_INTERVAL) return null;
        return Store.snapshot(state, 'automatisch');
      });
    },

    /* ------------------------------------------------- Speicher-Zustand */

    /**
     * Bittet den Browser, die Daten dauerhaft zu behalten. Ohne diese Zusage
     * darf der Browser sie bei Platzmangel selbsttaetig loeschen.
     */
    requestPersistence: function () {
      if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(null);
      return navigator.storage.persisted().then(function (already) {
        return already ? true : navigator.storage.persist();
      }).catch(function () { return null; });
    },

    isPersisted: function () {
      if (!navigator.storage || !navigator.storage.persisted) return Promise.resolve(null);
      return navigator.storage.persisted().catch(function () { return null; });
    },

    estimate: function () {
      if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
      return navigator.storage.estimate().catch(function () { return null; });
    },

    /** Zusammenfassung fuer die Anzeige in den Einstellungen. */
    status: function () {
      return Promise.all([Store.isPersisted(), Store.estimate(), Store.list(), openDb()])
        .then(function (r) {
          return {
            persisted: r[0],
            usage: r[1] ? r[1].usage : null,
            quota: r[1] ? r[1].quota : null,
            snapshots: r[2] ? r[2].length : null,
            indexedDB: r[3] !== null,
            localStorage: (function () {
              try { localStorage.setItem('pokerkasse.probe', '1');
                    localStorage.removeItem('pokerkasse.probe'); return true; }
              catch (e) { return false; }
            }()),
            lastExport: Store.lastExport()
          };
        });
    },

    lastExport: function () {
      try { return Number(localStorage.getItem(LS_EXPORT)) || null; } catch (e) { return null; }
    },

    markExported: function () {
      try { localStorage.setItem(LS_EXPORT, String(Date.now())); } catch (e) { /* egal */ }
    },

    /** Loescht alles – beide Speicher und alle Sicherungen. */
    clear: function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* egal */ }
      return Promise.all([
        run(KV, 'readwrite', function (s) { return s.delete('state'); }),
        run(SNAPS, 'readwrite', function (s) { return s.clear(); })
      ]);
    }
  };

  root.PokerStore = Store;
}(typeof window !== 'undefined' ? window : this));
