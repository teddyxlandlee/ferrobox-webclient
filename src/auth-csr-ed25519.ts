import { Buffer } from 'buffer';

export type CsrAttribute = 'CN' | 'O' | 'OU' | 'C' | 'L' | 'ST';

const SUBJECT_OIDS: Record<CsrAttribute, string> = {
    CN: '2.5.4.3',
    O: '2.5.4.10',
    OU: '2.5.4.11',
    C: '2.5.4.6',
    L: '2.5.4.7',
    ST: '2.5.4.8',
};

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    return Buffer.concat(parts)
}

function derLength(length: number): Uint8Array<ArrayBuffer> {
    if (length < 128) {
        return Uint8Array.of(length);
    }

    const bytes: number[] = [];
    let v = length;

    while (v > 0) {
        bytes.unshift(v & 0xff);
        v >>= 8;
    }

    return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, ...content: Uint8Array[]): Uint8Array<ArrayBuffer> {
    return concat(
        Uint8Array.of(tag),
        derLength(content.length),
        ...content,
    );
}

function sequence(...items: Uint8Array[]): Uint8Array<ArrayBuffer> {
    return der(0x30, ...items);
}

function set(...items: Uint8Array[]): Uint8Array<ArrayBuffer> {
    return der(0x31, ...items);
}

function integer(value: number): Uint8Array<ArrayBuffer> {
    return der(0x02, Uint8Array.of(value));
}

function utf8String(value: string): Uint8Array<ArrayBuffer> {
    return der(0x0c, new TextEncoder().encode(value));
}

function oid(oid: string): Uint8Array<ArrayBuffer> {
    const parts = oid.split('.').map(Number);

    const bytes: number[] = [
        parts[0] * 40 + parts[1],
    ];

    for (const part of parts.slice(2)) {
        const tmp: number[] = [];

        let v = part;

        tmp.unshift(v & 0x7f);
        v >>= 7;

        while (v > 0) {
            tmp.unshift((v & 0x7f) | 0x80);
            v >>= 7;
        }

        bytes.push(...tmp);
    }

    return der(0x06, Uint8Array.from(bytes));
}

function attribute(oidStr: string, value: string): Uint8Array<ArrayBuffer> {
    return set(sequence(oid(oidStr), utf8String(value)));
}

function subject(
    args: Partial<Record<CsrAttribute, string>>
): Uint8Array {
    const rdns: Uint8Array[] = [];

    const order: CsrAttribute[] = [
        'C', 'ST', 'L',
        'O', 'OU', 'CN',
    ];

    for (const key of order) {
        const value = args[key];
        if (!value) continue;

        rdns.push(attribute(SUBJECT_OIDS[key], value));
    }

    return sequence(...rdns);
}

function pem(label: string, derBytes: Uint8Array): string {
    const b64 = Buffer.from(derBytes)
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

export async function generateCSR(
    keyPair: CryptoKeyPair,
    args: Partial<Record<CsrAttribute, string>>
): Promise<string> {

    const spki = new Uint8Array(
        await crypto.subtle.exportKey(
            'spki',
            keyPair.publicKey,
        )
    );

    const cri = sequence(
        integer(0),
        subject(args),

        // SubjectPublicKeyInfo
        spki,

        // attributes [0]
        Uint8Array.of(0xa0, 0x00),
    );

    const signature = new Uint8Array(
        await crypto.subtle.sign(
            'Ed25519',
            keyPair.privateKey,
            cri,
        )
    );

    const ed25519AlgorithmIdentifier = sequence(oid('1.3.101.112'));

    const csr = sequence(
        cri,

        ed25519AlgorithmIdentifier,

        der(0x03, Uint8Array.of(0x00), signature)
    );

    return pem(
        'CERTIFICATE REQUEST',
        csr
    );
}