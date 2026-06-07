import * as WebCryptoAuth from './auth-webcrypto.js'
import * as WebAuthnAuth from './auth-webauthn.js'
import {getDbPromise} from "./auth-db";
import {Buffer} from "buffer";

export type KeyHandle = {
    type: 'webauthn' | 'webcrypto'
    id: string
}

export type SignResult =
    | WebCryptoSignResult
    | WebAuthnSignResult

interface SignResultBase {
    type: 'webcrypto' | 'webauthn'
    certs: readonly string[]
}

interface WebCryptoSignResult extends SignResultBase {
    type: 'webcrypto'
    signature: string
}

interface WebAuthnSignResult extends SignResultBase {
    type: 'webauthn'
    credentialId: string
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle: string | null
}

const STORE_NAME = 'certs';
const dbPromise = getDbPromise(STORE_NAME)

export async function readCerts(keyHandle: KeyHandle): Promise<(readonly string[]) | null> {
    const db = await dbPromise
    const tx = db.transaction(STORE_NAME, 'readonly')
    const id: string = keyHandle.type + ':' + keyHandle.id
    const request = tx.objectStore(STORE_NAME).get(id)
    return await new Promise((resolve, reject) => {
        request.onsuccess = () => {
            const value = request.result
            if (!Array.isArray(value) || !value.every(s => typeof s === 'string')) resolve(null)
            resolve(value)
        }

        request.onerror = () => reject(request.error)
    })
}

export async function signData(keyHandle: KeyHandle, data: string | Uint8Array<ArrayBuffer>): Promise<SignResult> {
    if (typeof data === 'string') {
        data = Buffer.from(data, 'utf-8')
    }
    const certs = await readCerts(keyHandle)
    if (certs === null) {
        throw Error('Certificates not found')
    }

    if (keyHandle.type === 'webcrypto') {
        const key: CryptoKey = await WebCryptoAuth.getKey(keyHandle.id)

        const signature = await crypto.subtle.sign('Ed25519', key, data)
        return {
            type: 'webcrypto',
            certs,
            signature: Buffer.from(signature).toString('base64')
        }
    } else {
        const challenge = await crypto.subtle.digest('SHA-256', data)
        const { rawId, response } = await WebAuthnAuth.challenge(keyHandle.id, challenge)

        return {
            type: 'webauthn',
            certs,
            credentialId: Buffer.from(rawId).toString('base64'),
            clientDataJSON: Buffer.from(response.clientDataJSON).toString('base64'),
            authenticatorData: Buffer.from(response.authenticatorData).toString('base64'),
            signature: Buffer.from(response.signature).toString('base64'),
            userHandle: response.userHandle ? Buffer.from(response.userHandle).toString('base64') : null,
        }
    }
}

// ─── Certificate Management ────────────────────────────────────────────────

export async function storeCerts(keyHandle: KeyHandle, certs: readonly string[]): Promise<void> {
    if (!certs.every(s => typeof s === 'string')) {
        throw Error('All certificates must be strings (PEM format)');
    }
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");
    const id: string = keyHandle.type + ':' + keyHandle.id;
    tx.objectStore(STORE_NAME).put(certs, id);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function deleteCerts(keyHandle: KeyHandle): Promise<void> {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");
    const id: string = keyHandle.type + ':' + keyHandle.id;
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function listAllHandles(): Promise<readonly KeyHandle[]> {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAllKeys();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const handles: KeyHandle[] = [];
    for (const k of keys) {
        if (typeof k !== 'string') continue;
        const colon = k.indexOf(':');
        if (colon === -1) continue;
        const t = k.substring(0, colon);
        const id = k.substring(colon + 1);
        if (t === 'webauthn' || t === 'webcrypto') {
            handles.push({ type: t, id });
        }
    }
    return handles;
}
