// IndexedDB：スマホの中にカード・未送信の評価・設定・復習ログを保存する
//   cards  … シートのカード（キー：ID）
//   outbox … まだシートに送っていない進捗（自動採番）
//   meta   … 設定や同期時刻など（キー：名前）
//   log    … 復習の記録（今週のグラフ用）

const DB_NAME = 'grass';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'ID' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).getAll());
}

export async function getAllWithKeys(store) {
  const db = await open();
  const os = db.transaction(store).objectStore(store);
  const [keys, values] = await Promise.all([result(os.getAllKeys()), result(os.getAll())]);
  return keys.map((key, i) => ({ key, value: values[i] }));
}

export async function get(store, key) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  return done(tx);
}

export async function add(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).add(value);
  return done(tx);
}

export async function deleteKeys(store, keys) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  keys.forEach(k => os.delete(k));
  return done(tx);
}

export async function clear(store) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

/** カードを丸ごと入れ替える（同期のとき） */
export async function replaceCards(cards) {
  const db = await open();
  const tx = db.transaction('cards', 'readwrite');
  const os = tx.objectStore('cards');
  os.clear();
  cards.forEach(c => os.put(c));
  return done(tx);
}

/** カードの進捗を保存し、同じトランザクションで送信待ちに積む（デモ中は積まない） */
export async function saveProgress(card, progress, { queue = true } = {}) {
  const db = await open();
  const tx = db.transaction(['cards', 'outbox'], 'readwrite');
  tx.objectStore('cards').put({ ...card, ...progress });
  if (queue) tx.objectStore('outbox').add({ ID: card.ID, ...progress, at: Date.now() });
  return done(tx);
}

export async function count(store) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).count());
}
