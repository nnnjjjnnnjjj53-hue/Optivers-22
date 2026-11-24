const IDB_NAME = 'optiverse_idb_v1';
const IDB_VERSION = 2;
const SNAPSHOT_STORE = 'snapshots';
const MODEL_STORE = 'models';

function isIndexedDbSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openOptiVerseDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbSupported()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          db.createObjectStore(SNAPSHOT_STORE);
        }
        if (!db.objectStoreNames.contains(MODEL_STORE)) {
          db.createObjectStore(MODEL_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbLoadSnapshot<T>(key = 'main_snapshot'): Promise<T | null> {
  const db = await openOptiVerseDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
      const store = tx.objectStore(SNAPSHOT_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve((req.result as T | undefined) ?? null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve(null);
    }
  });
}

export async function idbSaveSnapshot<T>(value: T, key = 'main_snapshot'): Promise<boolean> {
  const db = await openOptiVerseDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(SNAPSHOT_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve(false);
    }
  });
}

export async function idbDeleteSnapshot(key = 'main_snapshot'): Promise<void> {
  const db = await openOptiVerseDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve();
    }
  });
}

export async function idbGetCachedModel(key: string): Promise<ArrayBuffer | null> {
  const db = await openOptiVerseDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(MODEL_STORE)) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction(MODEL_STORE, 'readonly');
      const req = tx.objectStore(MODEL_STORE).get(key);
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve(null);
    }
  });
}

export async function idbPutCachedModel(key: string, buffer: ArrayBuffer): Promise<boolean> {
  const db = await openOptiVerseDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(MODEL_STORE)) {
        db.close();
        resolve(false);
        return;
      }
      const tx = db.transaction(MODEL_STORE, 'readwrite');
      const req = tx.objectStore(MODEL_STORE).put(buffer, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve(false);
    }
  });
}
