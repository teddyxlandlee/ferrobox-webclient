import {getDbPromise} from "./auth-db";

const STORE_NAME = 'auth-keys'
const dbPromise = getDbPromise(STORE_NAME)

/** @returns public key */
export async function generateKeyPair(
    id: string,
): Promise<ArrayBuffer> {

    const keyPair = await crypto.subtle.generateKey('Ed25519', false, ["sign"]);
    const publicKey = await crypto.subtle.exportKey(
        "spki",
        keyPair.publicKey,
    );

    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");

    tx.objectStore(STORE_NAME).put(keyPair.privateKey, id);

    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

    return publicKey;
}

export async function listKeys(): Promise<readonly string[]> {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAllKeys()
    return await new Promise<readonly string[]>((resolve, reject) => {
        request.onsuccess = () => {
            resolve(request.result.filter(k => typeof k === 'string'))
        }

        request.onerror = () => reject(request.error)
    })
}

export async function getKey(
    id: string,
): Promise<CryptoKey> {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);

    return await new Promise<CryptoKey>((resolve, reject) => {
        request.onsuccess = () => {
            const key = request.result;
            if (!(key instanceof CryptoKey)) {  // implicit null check
                reject(Error(`Key '${id}' not found`,));
                return;
            }

            resolve(key);
        };

        request.onerror = () => reject(request.error);
    });
}