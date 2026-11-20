// /admin/ stays signed in on this device: the device key (lib/unseal.ts) is kept in this browser's
// IndexedDB, so a reload or the next day's build opens without the password. The key cannot be read
// back out of the browser (it is not extractable) and the password is never stored. Sign out deletes it.
// Storage can be missing or refuse (a private window, blocked site data): then the page simply asks for
// the password each time.

export interface Remembered {
  key: CryptoKey;
  iterations: number; // the PBKDF2 rounds it was made with; a build with other rounds needs the password again
}

const DB = "campus-atlas-admin";
const STORE = "keys";
const ID = "device";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = ask(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function recall(): Promise<Remembered | null> {
  try {
    return ((await run("readonly", (s) => s.get(ID))) as Remembered | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function remember(r: Remembered): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(r, ID));
  } catch {
    // not kept: the next visit asks for the password again
  }
}

export async function forget(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(ID));
  } catch {
    // nothing kept, nothing to forget
  }
}
