const APP_NAME = 'ferrobox'

const REQUIRED_STORES = ['auth-keys', 'certs'];
let dbInitPromise: Promise<IDBDatabase> | null = null;

export function getDbPromise(_storeName: string): Promise<IDBDatabase> {
    if (!dbInitPromise) {
        dbInitPromise = new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(APP_NAME, 2);

            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of REQUIRED_STORES) {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name);
                    }
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    return dbInitPromise;
}