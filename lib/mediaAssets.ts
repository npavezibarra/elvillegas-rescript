/** Persistent local media library for reusable project assets. */

const DB_NAME = "rescript-media-assets";
const DB_VERSION = 1;
const STORE = "assets";

export interface MediaAssetMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

export interface MediaAsset extends MediaAssetMeta {
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Failed to open media library."));
    };
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Media library request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Media library transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Media library transaction aborted."));
  });
}

export async function listMediaAssets(): Promise<MediaAssetMeta[]> {
  const db = await openDb();
  const transaction = db.transaction(STORE, "readonly");
  const rows = await requestResult((transaction.objectStore(STORE).getAll() as IDBRequest<MediaAsset[]>));
  await transactionDone(transaction);
  return rows
    .map(({ id, name, type, size, createdAt }) => ({ id, name, type, size, createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const db = await openDb();
  const transaction = db.transaction(STORE, "readonly");
  const asset = await requestResult(
    transaction.objectStore(STORE).get(id) as IDBRequest<MediaAsset | undefined>
  );
  await transactionDone(transaction);
  return asset ?? null;
}

export async function putMediaAsset(file: File): Promise<MediaAssetMeta> {
  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    createdAt: Date.now(),
    blob: file,
  };
  const db = await openDb();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).put(asset);
  await transactionDone(transaction);
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    size: asset.size,
    createdAt: asset.createdAt,
  };
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(id);
  await transactionDone(transaction);
}
