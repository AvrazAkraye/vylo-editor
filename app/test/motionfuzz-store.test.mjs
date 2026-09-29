// Stored graphics under attack (motionstore.ts): records an older build or a
// hand-edited database left behind — no graphic at all, a hundred thousand
// layers, an id the reader cannot keep.
//
// What matters: loading is quick whatever a record holds, every record that is
// a graphic comes back repaired, and nothing stays in storage that the list
// does not show — a graphic whose stored id the reader cannot keep (empty,
// blank, a number, overlong, a control character) is either listed under one
// id, the same on every load, so it can be opened and deleted, or removed; it
// is never hidden while its record, pictures and all, is kept for good.
//
// Checks marked "fails today" prove a bug and pass once it is fixed.
import { deleteMotion, loadMotions, saveMotion } from '../.test-build/motionstore.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** One store of IndexedDB, as test/motionstore.test.mjs fakes it: callbacks fire later, values are structured clones. */
function fakeIndexedDB() {
  const later = (fn) => setTimeout(fn, 0);
  const stores = new Map();
  return {
    stores,
    open(name, version) {
      const req = { result: undefined, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      later(() => {
        const db = {
          name, version, onclose: null,
          objectStoreNames: { contains: (s) => stores.has(s) },
          createObjectStore(s, opts) { stores.set(s, { keyPath: opts.keyPath, data: new Map() }); },
          transaction(s, mode) {
            const store = stores.get(s);
            const tx = { oncomplete: null, onabort: null, onerror: null };
            const writes = [];
            let settling = false;
            const settle = () => { if (!settling) { settling = true; later(() => { for (const w of writes) w(); tx.oncomplete?.(); }); } };
            const request = (fn) => {
              const r = { result: undefined, onsuccess: null, onerror: null };
              later(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } });
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
              getAll() { return request(() => [...store.data.values()].map((v) => structuredClone(v))); },
              delete(key) {
                if (key === undefined || key === null) throw new Error('DataError');
                writes.push(() => store.data.delete(key));
                return request(() => undefined);
              },
            });
            return tx;
          },
        };
        req.result = db;
        if (!stores.size) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

globalThis.indexedDB = fakeIndexedDB();
await loadMotions();
const data = globalThis.indexedDB.stores.get('motions').data;
const PALETTE = { bg: '#000000', fg: '#ffffff', accent: '#ff0000', accent2: '#00ff00', muted: '#888888' };
const graphic = (id, o = {}) => ({ id, title: `G ${String(id).slice(0, 8)}`, seconds: 6, palette: PALETTE, layers: [], created: 1, updated: 1, ...o });

// ── cost and shape ────────────────────────────────────────────────────────
console.log('cost');
{
  data.set('big', graphic('big', { title: 'T'.repeat(5_000_000), layers: Array.from({ length: 100_000 }, (_, i) => ({ kind: 'text', id: `l${i}`, text: 'x' })) }));
  for (let i = 0; i < 200; i++) data.set(`k${i}`, graphic(`k${i}`, { updated: i }));
  for (const [k, v] of [['n', null], ['s', 'str'], ['a', [1, 2]], ['f', { id: 'f', layers: 'nope', palette: 7, seconds: 'NaN' }]]) data.set(k, v);
  const t0 = performance.now();
  const all = await loadMotions();
  const dt = performance.now() - t0;
  const big = all.find((m) => m.id === 'big');
  ok(`205 records, one of 100,000 layers and a 5 MB title: loaded in ${dt.toFixed(0)} ms, capped`, dt < 500 && big.layers.length === 60 && big.title.length === 120, dt);
  ok('what is not a graphic is left out, the rest are repaired', !all.some((m) => ['n', 's', 'a'].includes(m.id)) && all.some((m) => m.id === 'f' && m.seconds === 6));
  data.clear();
}

// ── a graphic whose id had to be replaced ─────────────────────────────────
console.log('ids');
{
  // readMotion replaces an empty, blank, numeric, overlong or control-character id with a fresh random one on every
  // read. Before this review loadMotions listed such a record under a new id each launch (undeletable, and an edit
  // saved a second copy); it now leaves the record out of the list. Fails today: the record is still kept — hidden,
  // never listed, never removed, with whatever pictures it holds — so a graphic silently disappears and its storage
  // is never given back. Re-keying it on load (put under the new id, delete the old key) would keep both promises.
  const odd = ['', '   ', 42, 'x'.repeat(129), 'bad\u0000id'];
  for (const id of odd) data.set(id, graphic(id));
  const first = (await loadMotions()).map((m) => m.id).sort();
  const second = (await loadMotions()).map((m) => m.id).sort();
  ok('a listed graphic has the same id on every load', JSON.stringify(first) === JSON.stringify(second), [first, second]);
  const hidden = data.size - second.length;
  ok('nothing in storage is left out of the list: each such record is listed (and so can be deleted) or removed', hidden === 0,
    `${hidden} of ${data.size} records hidden: ${[...data.keys()].map((k) => JSON.stringify(k).slice(0, 12)).join(' ')}`);
  for (const id of second) await deleteMotion(id);
  await loadMotions();
  ok('deleting every graphic the list shows leaves no record behind', data.size === 0, [...data.keys()].map((k) => JSON.stringify(k).slice(0, 12)));
  data.clear();
  data.set('ok-1', graphic('ok-1'));
  const one = (await loadMotions())[0];
  await saveMotion({ ...one, title: 'edited', updated: 9 });
  const after = await loadMotions();
  ok('a graphic edited and saved again is one record', after.length === 1 && after[0].title === 'edited' && data.size === 1, after.map((m) => [m.id, m.title]));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
