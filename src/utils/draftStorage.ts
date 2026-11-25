import { EyewearFrameMode, EyewearSubMode, FrameCat, FrameMaterial, FrameType } from '../types';

const DRAFT_DB_NAME = 'optiverse_drafts_v1';
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE = 'merchant_drafts';

export interface PersistedDraftFrame {
  localId: string;
  shopId: string;
  savedProductId?: string;
  name: string;
  code: string;
  modelCode?: string;
  price: number;
  salePrice?: number;
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  cat: FrameCat;
  material: FrameMaterial;
  type: FrameType;
  frameWidthMm: number;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  ocrFound?: boolean;
  isCrystalFrame?: boolean;
  keepLensBranding?: boolean;
  opticalDimensions: string;
  fitScale: number;
  eyeLineOffset: number;
  status: 'extracting_dims' | 'reviewing_dims' | 'enhancing' | 'ready' | 'error';
  stageLabel: string;
  errorMsg?: string;
  approved: boolean;
  isPublished: boolean;
  aspectRatio: number;
  frameHexColor: string;
  frameOpacity: number;
  imagePath?: string; // 1200px transparent Try-On PNG/WebP
  frontCatalogPath?: string; // 1200x900 #F8F9FA studio WebP
  sideImagePath?: string; // 1200x900 #F8F9FA 3/4 side WebP
  clipOnImagePath?: string;
  clipOnFrontCatalogPath?: string;
  clipOnSideImagePath?: string;
  lensMaskUrl?: string;
  originalThumbDataUrl?: string;
  updatedAt: number;
}

function isIdbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDraftDb(): Promise<IDBDatabase | null> {
  if (!isIdbAvailable()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          const store = db.createObjectStore(DRAFT_STORE, { keyPath: 'localId' });
          store.createIndex('shopId', 'shopId', { unique: false });
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

export async function saveDraftFrame(draft: PersistedDraftFrame): Promise<boolean> {
  const db = await openDraftDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      const store = tx.objectStore(DRAFT_STORE);
      const req = store.put({ ...draft, updatedAt: Date.now() });
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

export async function loadDraftFrames(shopId: string): Promise<PersistedDraftFrame[]> {
  const db = await openDraftDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readonly');
      const store = tx.objectStore(DRAFT_STORE);
      const idx = store.index('shopId');
      const req = idx.getAll(shopId);
      req.onsuccess = () => {
        const rows = (req.result as PersistedDraftFrame[] | undefined) || [];
        rows.sort((a, b) => a.updatedAt - b.updatedAt);
        resolve(rows);
      };
      req.onerror = () => resolve([]);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve([]);
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve([]);
    }
  });
}

export async function deleteDraftFrame(localId: string): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).delete(localId);
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

export async function clearShopDrafts(shopId: string): Promise<void> {
  const rows = await loadDraftFrames(shopId);
  if (!rows.length) return;
  const db = await openDraftDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      const store = tx.objectStore(DRAFT_STORE);
      for (const row of rows) {
        store.delete(row.localId);
      }
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
