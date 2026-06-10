import {getDbPromise} from "./auth-db";

const STORE_NAME = 'auth-keys'
const dbPromise = getDbPromise(STORE_NAME)

/** @returns public key, in SPKI format */
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

    tx.objectStore(STORE_NAME).put(keyPair, id);

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
): Promise<CryptoKeyPair> {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);

    return await new Promise<CryptoKeyPair>((resolve, reject) => {
        request.onsuccess = () => {
            const key = request.result as any;
            // if (!(key.publicKey instanceof CryptoKey)) {  // implicit null check
            //     reject(Error(`Key '${id}' not found`,));
            //     return;
            // }
            if (!key || !(key.publicKey instanceof CryptoKey) || !(key.privateKey instanceof CryptoKey)) {
                reject(Error(`Key '${id}' not found`));
                return;
            }

            resolve(key);
        };

        request.onerror = () => reject(request.error);
    });
}

export async function deleteKey(id: string): Promise<void> {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export { generateCSR } from './auth-csr-ed25519';