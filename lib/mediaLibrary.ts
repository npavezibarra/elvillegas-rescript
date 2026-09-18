"use client";

import { detectMediaKind, type MediaKind } from "./media";
import type { SpeakerInfo, Word } from "./types";

const DB_NAME = "rescript-media-library";
const DB_VERSION = 1;
const STORE = "files";

export type LibraryFileSource = "upload" | "youtube";

export interface LibraryFileMeta {
  id: string;
  name: string;
  mediaKind: MediaKind;
  mediaType: string;
  size: number;
  source: LibraryFileSource;
  transcriptStatus: "none" | "ready";
  transcriptWordCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryFileRecord extends LibraryFileMeta {
  media: Blob;
  words?: Word[];
  speakers?: SpeakerInfo[];
}

let dbPromise: Promise<IDBDatabase> | null = null;
let liveDb: IDBDatabase | null = null;

function forgetDb(db: IDBDatabase) {
  if (liveDb !== db) return;
  liveDb = null;
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      liveDb = db;
      db.onversionchange = () => {
        db.close();
        forgetDb(db);
      };
      db.onclose = () => forgetDb(db);
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Failed to open media library DB."));
    };
  });
  return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function libraryFileId(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return hex(digest);
}

export async function listLibraryFiles(): Promise<LibraryFileMeta[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const rows = await idbReq(tx.objectStore(STORE).getAll() as IDBRequest<LibraryFileRecord[]>);
  await txDone(tx);
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      mediaKind: row.mediaKind,
      mediaType: row.mediaType,
      size: row.size,
      source: row.source,
      transcriptStatus:
        row.words && row.words.length > 0
          ? ("ready" as const)
          : ("none" as const),
      transcriptWordCount: row.words?.length ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getLibraryFile(id: string): Promise<LibraryFileRecord | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const row = await idbReq(
    tx.objectStore(STORE).get(id) as IDBRequest<LibraryFileRecord | undefined>
  );
  await txDone(tx);
  return row ?? null;
}

export async function putLibraryFile(
  file: File,
  source: LibraryFileSource
): Promise<string | null> {
  const mediaKind = detectMediaKind(file);
  if (!mediaKind) return null;

  const id = await libraryFileId(file);
  const now = Date.now();
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = await idbReq(store.get(id) as IDBRequest<LibraryFileRecord | undefined>);
  const record: LibraryFileRecord = {
    id,
    name: existing?.name ?? file.name,
    mediaKind,
    mediaType: file.type || existing?.mediaType || "application/octet-stream",
    size: file.size,
    source: existing?.source ?? source,
    transcriptStatus:
      existing?.words && existing.words.length > 0 ? "ready" : "none",
    transcriptWordCount: existing?.words?.length ?? 0,
    media: existing?.media ?? file,
    words: existing?.words,
    speakers: existing?.speakers,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  store.put(record);
  await txDone(tx);
  return id;
}

export async function saveLibraryTranscriptForFile(
  file: File,
  words: Word[],
  speakers?: SpeakerInfo[]
): Promise<void> {
  if (words.length === 0) return;
  const id = await libraryFileId(file);
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = await idbReq(store.get(id) as IDBRequest<LibraryFileRecord | undefined>);
  if (!existing) {
    await txDone(tx);
    return;
  }
  store.put({
    ...existing,
    words,
    speakers: speakers ?? [],
    transcriptStatus: "ready",
    transcriptWordCount: words.length,
    updatedAt: Date.now(),
  } satisfies LibraryFileRecord);
  await txDone(tx);
}

export async function deleteLibraryFile(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
}

export function fileFromLibraryRecord(record: LibraryFileRecord): File {
  return new File([record.media], record.name, {
    type: record.mediaType || record.media.type || undefined,
    lastModified: record.updatedAt,
  });
}
