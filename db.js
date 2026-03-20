const DB_NAME = 'pwa-noty';
const DB_VERSION = 3;
const STORE_NOTES = 'notes';
const STORE_FOLDERS = 'folders';
const STORE_TAGS = 'tags';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TAGS)) {
        db.createObjectStore(STORE_TAGS, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror  = (e) => reject(e.target.error);
  });
}

export async function getAllNotes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NOTES, 'readonly').objectStore(STORE_NOTES).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function saveNote(note) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NOTES, 'readwrite').objectStore(STORE_NOTES).put(note);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}

export async function deleteNote(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NOTES, 'readwrite').objectStore(STORE_NOTES).delete(id);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}

export async function getAllFolders() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_FOLDERS, 'readonly').objectStore(STORE_FOLDERS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function saveFolder(folder) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_FOLDERS, 'readwrite').objectStore(STORE_FOLDERS).put(folder);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}

export async function deleteFolder(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_FOLDERS, 'readwrite').objectStore(STORE_FOLDERS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}

export async function getAllTags() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_TAGS, 'readonly').objectStore(STORE_TAGS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function saveTag(tag) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_TAGS, 'readwrite').objectStore(STORE_TAGS).put(tag);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}

export async function deleteTag(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_TAGS, 'readwrite').objectStore(STORE_TAGS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}
