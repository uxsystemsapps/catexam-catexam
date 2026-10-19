import type { DataDir } from '../core/store';

const STORE = 'files';

function done<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

/**
 * The profile folder of the Android app: one IndexedDB object store keyed by file name. It lives in the
 * app's private data, so it survives updates and is removed when the app is uninstalled.
 */
export async function indexedDbDir(name: string): Promise<DataDir> {
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  const db = await done(open);
  const store = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(STORE, mode).objectStore(STORE);
  return {
    async read(file) {
      const text: unknown = await done(store('readonly').get(file));
      return typeof text === 'string' ? text : null;
    },
    async write(file, text) {
      await done(store('readwrite').put(text, file));
    },
    async list(dir) {
      const prefix = dir ? `${dir}/` : '';
      const keys = await done(store('readonly').getAllKeys());
      return keys.map(String).filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => k.slice(prefix.length));
    },
    async remove(file) {
      await done(store('readwrite').delete(file));
    },
  };
}

/** The question banks shipped inside the app (www/questions/, listed in its index.json); read-only. */
export function shippedDir(base: string): DataDir {
  const get = async (file: string): Promise<string> => {
    const response = await fetch(`${base}/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return response.text();
  };
  return {
    read: get,
    async list(dir) {
      if (dir) return [];
      return JSON.parse(await get('index.json')) as string[];
    },
    write: () => Promise.reject(new Error('the shipped banks are read-only')),
    remove: () => Promise.reject(new Error('the shipped banks are read-only')),
  };
}
