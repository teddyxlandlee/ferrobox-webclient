import {getDbPromise} from "./auth-db";
import {Buffer} from 'buffer';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

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

type CsrAttribute = 'CN' | 'O' | 'OU' | 'C' | 'L' | 'ST';

const SUBJECT_OIDS: Record<CsrAttribute, string> = {
    CN: '2.5.4.3',  // Common Name
    O:  '2.5.4.10', // Organization
    OU: '2.5.4.11', // Organizational Unit
    C:  '2.5.4.6',  // Country
    L:  '2.5.4.7',  // Locality
    ST: '2.5.4.8',  // State/Province
};

function pemEncode(label: string, der: ArrayBuffer): string {
    const b64 = Buffer.from(der)
        .toString('base64')
        .match(/.{1,64}/g)!
        .join('\n');

    return [
        `-----BEGIN ${label}-----`,
        b64,
        `-----END ${label}-----`,
        '',
    ].join('\n');
}

/**
 * Generates a PEM-encoded CSR (PKCS#10) from a Web Crypto Ed25519 key pair.
 * The private key must have usage `['sign']` and may be non-extractable.
 *
 * @param keyPair - CryptoKeyPair with Ed25519 keys
 * @param args - Subject attributes (only provided keys are included)
 * @returns PEM string of the CSR
 */
export async function generateCSR(
  keyPair: CryptoKeyPair,
  args: Partial<Record<CsrAttribute, string>>
): Promise<string> {
    const csr = new pkijs.CertificationRequest();

    for (const [k, v] of Object.entries(args)) {
        if (!v) continue;

        csr.subject.typesAndValues.push(
            new pkijs.AttributeTypeAndValue({
                type: SUBJECT_OIDS[k as CsrAttribute],
                value: new asn1js.Utf8String({value: v}),
            }),
        );
    }
    await csr.subjectPublicKeyInfo.importKey(keyPair.publicKey);
    csr.attributes = [];

    // Ed25519
    await csr.sign(keyPair.privateKey, 'SHA-256');
    const der = csr.toSchema(true).toBER(false);
    return pemEncode('CERTIFICATE REQUEST', der);
}


