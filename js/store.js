/* =========================================================
   PERSISTÊNCIA — IndexedDB para áudio, localStorage fica com a sessão.
   Float32 em RAM, Int16 no disco: metade do espaço e diferença inaudível
   depois que o sample já passou pelo microfone.
   ========================================================= */
const DB_NAME = 'cabacitos-mpc';
const DB_VER = 1;

let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((ok, err) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => err(rq.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((ok, err) => {
    const t = d.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => ok(rq && rq.result);
    t.onerror = () => err(t.error);
  }));
}

export function f32ToI16(f) {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function i16ToF32(src) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 0x8000;
  return out;
}

export const putSample = (id, name, sr, data) =>
  tx('samples', 'readwrite', (s) => s.put({ name, sr, i16: f32ToI16(data).buffer }, id));

export const delSample = (id) => tx('samples', 'readwrite', (s) => s.delete(id));

export async function allSamples() {
  const d = await db();
  return new Promise((ok, err) => {
    const t = d.transaction('samples', 'readonly');
    const s = t.objectStore('samples');
    const out = [];
    s.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      out.push({ id: c.key, name: c.value.name, sr: c.value.sr, data: i16ToF32(new Int16Array(c.value.i16)) });
      c.continue();
    };
    t.oncomplete = () => ok(out);
    t.onerror = () => err(t.error);
  });
}

export const putProject = (obj) => tx('meta', 'readwrite', (s) => s.put(obj, 'project'));
export const getProject = () => tx('meta', 'readonly', (s) => s.get('project'));
