// Keeping motion graphics between sessions, in IndexedDB.
//
// What matters: a graphic saved comes back as it was, newest first; a record
// that is not a graphic is left out, and one from an older build or a
// hand-edited file is repaired on the way in, so the panel never draws a
// stored record unchecked; and when storage is refused — no IndexedDB, an
// open that fails or is blocked, a transaction that aborts on a full disk, a
// connection closed under us — every call resolves (false, [] or nothing)
// instead of throwing, and the next call tries again.
import { deleteMotion, loadMotions, saveMotion } from '../.test-build/motionstore.js';
import { LIMITS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/**
 * Just enough IndexedDB: open (with upgradeneeded, success, error, blocked),
 * transactions that complete or abort after their requests, and put, getAll
 * and delete on one store. Callbacks fire later, as the real ones do, and
 * values are stored as structured clones, as the real ones are.
 */
function fakeIndexedDB() {
  const later = (fn) => setTimeout(fn, 0);
  const idb = {
    mode: { open: 'ok', abortWrites: false, throwOnTransaction: false, getAllFails: false },
    stores: new Map(),
    opens: 0,
    last: null,
    open(name, version) {
      idb.opens++;
      const req = { result: undefined, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      later(() => {
        if (idb.mode.open === 'error') return req.onerror?.();
        if (idb.mode.open === 'blocked') return req.onblocked?.();
        const db = {
          name, version, onclose: null,
          objectStoreNames: { contains: (s) => idb.stores.has(s) },
          createObjectStore(s, opts) { idb.stores.set(s, { keyPath: opts.keyPath, data: new Map() }); },
          transaction(s, mode) {
            if (idb.mode.throwOnTransaction) throw new Error('InvalidStateError');
            const store = idb.stores.get(s);
            if (!store) throw new Error('NotFoundError');
            const tx = { oncomplete: null, onabort: null, onerror: null };
            const writes = [];
            let settling = false;
            const settle = () => {
              if (settling) return;
              settling = true;
              later(() => {
                if (mode === 'readwrite' && idb.mode.abortWrites) return tx.onabort?.();
                for (const w of writes) w();
                tx.oncomplete?.();
              });
            };
            const request = (fn) => {
              const r = { result: undefined, onsuccess: null, onerror: null };
              later(() => {
                try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); }
              });
              settle();
              return r;
            };
            tx.objectStore = () => ({
              put(value) {
                const copy = structuredClone(value);
                const key = copy?.[store.keyPath];
                if (typeof key !== 'string' && typeof key !== 'number') throw new Error('DataError');
                writes.push(() => store.data.set(key, copy));
                return request(() => key);
              },
              getAll() {
                return request(() => {
                  if (idb.mode.getAllFails) throw new Error('UnknownError');
                  return [...store.data.values()].map((v) => structuredClone(v));
                });
              },
              delete(key) {
                writes.push(() => store.data.delete(key));
                return request(() => undefined);
              },
            });
            return tx;
          },
        };
        idb.last = db;
        req.result = db;
        if (!idb.stores.size) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return idb;
}

const PALETTE = { bg: '#0b1020', fg: '#f5f7ff', accent: '#4c8dff', accent2: '#ff6aa2', muted: '#8a93b2' };
const graphic = (id, updated, o = {}) => ({
  id, title: `Graphic ${id}`, request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 6, palette: PALETTE, backdrop: 'bg',
  layers: [], stage: 'ready', created: 1, updated, ...o,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── no storage at all ─────────────────────────────────────────────────────
console.log('refused');
ok('with no IndexedDB, loading finds nothing', same(await loadMotions(), []));
ok('saving says it could not', (await saveMotion(graphic('a', 1))) === false);
ok('deleting resolves', (await deleteMotion('a').then(() => 'resolved', () => 'rejected')) === 'resolved');

const idb = fakeIndexedDB();
globalThis.indexedDB = idb;
idb.mode.open = 'error';
ok('an open that fails: nothing loaded, nothing saved, nothing thrown', same(await loadMotions(), []) && (await saveMotion(graphic('a', 1))) === false);
idb.mode.open = 'blocked';
ok('an open that is blocked: the same', same(await loadMotions(), []) && (await saveMotion(graphic('a', 1))) === false);
ok('a refusal is not remembered: every call tried again', idb.opens === 4, idb.opens);

// ── a working store ───────────────────────────────────────────────────────
console.log('kept');
idb.mode.open = 'ok';
const a = graphic('a', 100, { title: 'Older' });
const b = graphic('b', 300, { title: 'Newest', layers: [] });
const c = graphic('c', 200, { title: 'Middle', recipe: { id: 'quote', fields: { quote: 'Less, but better.' } } });
ok('saving says so once it is on disk', (await saveMotion(a)) === true && (await saveMotion(b)) === true && (await saveMotion(c)) === true);
ok('the store was made on first open, keyed by id', idb.stores.get('motions')?.keyPath === 'id');
const loaded = await loadMotions();
ok('everything saved comes back, most recently changed first', same(loaded.map((m) => m.id), ['b', 'c', 'a']), loaded.map((m) => m.id));
ok('each exactly as it was saved', same(loaded[2], a) && same(loaded[0], b) && same(loaded[1], c), loaded[1]);
ok('and as copies: changing one loaded does not change what is kept', (() => { loaded[0].title = 'changed'; return true; })()
  && (await loadMotions())[0].title === 'Newest');
ok('one connection serves every call', idb.opens === 5, idb.opens);
ok('saving a graphic again replaces it', (await saveMotion({ ...a, title: 'Renamed', updated: 400 })) === true
  && same((await loadMotions()).map((m) => [m.id, m.title]), [['a', 'Renamed'], ['b', 'Newest'], ['c', 'Middle']]));

// ── records from elsewhere ────────────────────────────────────────────────
console.log('records');
{
  const data = idb.stores.get('motions').data;
  data.set('junk1', 'not a graphic');
  data.set('junk2', {});
  data.set('junk3', { foo: 1 });
  data.set('junk4', null);
  data.set('old', { id: 'old', title: '  From an older build  ', seconds: 99, fps: 25, stage: 'planning', updated: 500,
    layers: [{ kind: 'text', text: 'Hi', size: 1e9 }, { kind: 'hologram' }, { kind: 'image', src: 'https://evil.example/x.png' }] });
  const all = await loadMotions();
  ok('a record that is not a graphic is left out', same(all.map((m) => m.id), ['old', 'a', 'b', 'c']), all.map((m) => m.id));
  const old = all[0];
  ok('one from an older build is repaired on the way in', old.title === 'From an older build' && old.seconds === 30 && old.fps === 30
    && old.layers.length === 2 && old.layers[0].size === LIMITS.fontSize && old.layers[1].src === '', old);
  ok('a graphic stored while the model was planning is ready again', old.stage === 'ready');
  data.delete('junk1'); data.delete('junk2'); data.delete('junk3'); data.delete('junk4');
}

// ── forgetting ────────────────────────────────────────────────────────────
console.log('forgetting');
await deleteMotion('old');
await deleteMotion('never-was');
ok('a deleted graphic is gone, the rest kept; deleting what is not there is fine', same((await loadMotions()).map((m) => m.id), ['a', 'b', 'c']));

// ── refusals on an open connection ────────────────────────────────────────
console.log('failures');
idb.mode.abortWrites = true;
ok('a write the disk refuses (the transaction aborts) is false', (await saveMotion(graphic('d', 900))) === false);
ok('and nothing of it is kept', !(await loadMotions()).some((m) => m.id === 'd'));
await deleteMotion('a');
ok('a delete that aborts leaves the graphic, and still resolves', (await loadMotions()).some((m) => m.id === 'a'));
idb.mode.abortWrites = false;
ok('what cannot be stored at all (a function inside) is false, not a throw', (await saveMotion({ ...graphic('e', 1), draw() {} })) === false);
idb.mode.getAllFails = true;
ok('a read that fails is nothing loaded', same(await loadMotions(), []));
idb.mode.getAllFails = false;
idb.mode.throwOnTransaction = true;
ok('a transaction that cannot start: [], false, and a resolved delete',
  same(await loadMotions(), []) && (await saveMotion(graphic('f', 1))) === false && (await deleteMotion('a').then(() => 'resolved')) === 'resolved');
idb.mode.throwOnTransaction = false;

// ── a record whose id could not be kept ───────────────────────────────────
console.log('re-keyed');
{
  const data = idb.stores.get('motions').data;
  data.set('', graphic('', 700, { title: 'No usable id' }));
  idb.mode.abortWrites = true;
  ok('when the move to a new id is refused, the graphic is left out (never listed under an id storage does not hold)',
    same((await loadMotions()).map((m) => m.id), ['a', 'b', 'c']) && data.has(''));
  idb.mode.abortWrites = false;
  const moved = await loadMotions();
  const fresh = moved.find((m) => m.title === 'No usable id');
  ok('and is moved on the next load: kept under its new id, the old record gone', !!fresh && fresh.id !== '' && data.has(fresh.id) && !data.has(''), fresh?.id);
  ok('the same id on every load after that', same((await loadMotions()).map((m) => m.id), moved.map((m) => m.id)));
  await deleteMotion(fresh.id);
  ok('so it can be deleted like any other', same((await loadMotions()).map((m) => m.id), ['a', 'b', 'c']) && data.size === 3);
}

// ── a connection closed under us ──────────────────────────────────────────
console.log('reconnect');
{
  const before = idb.opens;
  ok('the store listens for the browser closing its connection', typeof idb.last.onclose === 'function');
  idb.last.onclose?.();
  const back = await loadMotions();
  ok('after the browser closes the connection, the next call opens a new one', idb.opens === before + 1 && same(back.map((m) => m.id), ['a', 'b', 'c']), idb.opens - before);
  idb.last.onclose?.();
  idb.mode.open = 'error';
  ok('and if that open fails, the call still resolves', same(await loadMotions(), []) && (await saveMotion(graphic('g', 1))) === false);
  idb.mode.open = 'ok';
  ok('until storage comes back', (await loadMotions()).length === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
