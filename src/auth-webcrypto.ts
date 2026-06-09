import {getDbPromise} from "./auth-db";
import {Buffer} from 'buffer';
import {
    AttributeTypeAndValue,
    RelativeDistinguishedNames,
    PublicKeyInfo,
    AlgorithmIdentifier,
} from 'pkijs';
import {
    fromBER,
    BitString,
    Utf8String,
    Sequence,
    Integer,
} from 'asn1js';

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

const oidMap: Record<CsrAttribute, string> = {
    CN: '2.5.4.3',  // Common Name
    O:  '2.5.4.10', // Organization
    OU: '2.5.4.11', // Organizational Unit
    C:  '2.5.4.6',  // Country
    L:  '2.5.4.7',  // Locality
    ST: '2.5.4.8',  // State/Province
};

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
    // Build subject RDN sequence from provided attributes
    const attrTypesAndValues: AttributeTypeAndValue[] = [];
    for (const [attr, value] of Object.entries(args)) {
        if (!value) continue;
        const oid = oidMap[attr as CsrAttribute];
        if (!oid) continue;
        attrTypesAndValues.push(new AttributeTypeAndValue({
            type: oid,
            value: new Utf8String({ value: value }),
        }));
    }

    // Subject is a RelativeDistinguishedNames containing an array of AttributeTypeAndValue
    const subject = new RelativeDistinguishedNames({
        typesAndValues: attrTypesAndValues,
    });

    // Export and parse the public key SPKI
    const spkiRaw = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const asn1Result = fromBER(new Uint8Array(spkiRaw).buffer);
    const subjectPKInfo = new PublicKeyInfo({ schema: asn1Result.result });

    // Ed25519 signature algorithm identifier
    const signAlgId = new AlgorithmIdentifier({
        algorithmId: '1.3.101.112', // id-Ed25519
    });

    // Build the TBS certification request manually using asn1js
    const versionInt = new Integer({ value: 0 });

    // TBS sequence: version [0] EXPLICIT INTEGER, subject, subjectPublicKeyInfo, attributes [1]
    const tbsValue = new Sequence({
        value: [
            // version [0] EXPLICIT INTEGER 0
            new Sequence({
                value: [versionInt],
                idBlock: {
                    tagClass: 3, // context-specific
                    tagNumber: 0,
                },
            }),
            subject.toSchema(),
            subjectPKInfo.toSchema(),
            // attributes [1] empty sequence (context-specific)
            new Sequence({
                value: [],
                idBlock: {
                    tagClass: 3, // context-specific
                    tagNumber: 1,
                },
            }),
        ],
    });

    const tbsBytes = tbsValue.toBER(false);
    const tbsView = new Uint8Array(tbsBytes);

    // Sign using the private key
    const signatureRaw = await crypto.subtle.sign('Ed25519', keyPair.privateKey, tbsView);
    const sigBits = new BitString({ valueHex: new Uint8Array(signatureRaw) });

    // Build the full CertificationRequest ASN.1 structure
    const fullSeq = new Sequence({
        value: [
            tbsValue,
            signAlgId.toSchema(),
            sigBits,
        ],
    });

    const fullBer = fullSeq.toBER(false);

    // Convert to PEM
    const b64 = Buffer.from(fullBer).toString('base64');
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) {
        lines.push(b64.substring(i, i + 64));
    }

    return '-----BEGIN CERTIFICATE REQUEST-----\n' +
           lines.join('\n') + '\n' +
           '-----END CERTIFICATE REQUEST-----';
}


