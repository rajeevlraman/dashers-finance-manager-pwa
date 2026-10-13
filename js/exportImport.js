// exportImport.js
import { getAllItems, STORE_NAMES, openDb } from './db.js';
import { addItem } from './db.js';

export function exportData() {
  const stores = Object.values(STORE_NAMES);
  const promises = stores.map(storeName => getAllItems(storeName).then(items => ({ storeName, items })));
  return Promise.all(promises).then(results => {
    const exportObj = { timestamp: new Date().toISOString(), data: {} };
    for (const { storeName, items } of results) {
      exportObj.data[storeName] = items;
    }
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget‑tracker‑backup‑${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function clearStore(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

export async function importData(file, options = { overwrite: false }) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importObj = JSON.parse(e.target.result);
        if (!importObj.data) {
          throw new Error('Invalid backup file');
        }
        if (options.overwrite) {
          const clearPromises = Object.values(STORE_NAMES).map(store => clearStore(store));
          await Promise.all(clearPromises);
        }
        const writePromises = [];
        for (const storeName of Object.values(STORE_NAMES)) {
          const items = importObj.data[storeName] || [];
          for (const item of items) {
            writePromises.push(addItem(storeName, item));
          }
        }
        await Promise.all(writePromises);
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e.target.error);
    reader.readAsText(file);
  });
}
