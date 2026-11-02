import type { Doc } from './state';

/** Autosave of the current project in this browser (IndexedDB, so images fit). */

const DB_NAME = 'smotra-layout';
const STORE = 'kv';
const KEY = 'project';

export interface SavedFile {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

export interface SavedProject {
  doc: Doc;
  files: SavedFile[];
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveProject(p: SavedProject): Promise<void> {
  await run('readwrite', (s) => s.put(p, KEY));
}

export async function loadProject(): Promise<SavedProject | undefined> {
  return (await run('readonly', (s) => s.get(KEY))) as SavedProject | undefined;
}

export async function clearProject(): Promise<void> {
  await run('readwrite', (s) => s.delete(KEY));
}
