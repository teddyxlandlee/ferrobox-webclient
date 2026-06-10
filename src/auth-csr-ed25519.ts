import { Buffer } from 'buffer';

export type CsrAttribute =
    | 'CN'
    | 'O'
    | 'OU'
    | 'C'
    | 'L'
    | 'ST';

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

    while (length > 0) {
        bytes.unshift(length & 0xff);
        length >>= 8;
    }

    return Uint8Array.of(
        0x80 | bytes.length,
        ...bytes,
    );
}

function der(
    tag: number,
    ...content: Uint8Array[]
): Uint8Array<ArrayBuffer> {

    const body = concat(...content);

    return concat(
        Uint8Array.of(tag),
        derLength(body.length),
        body,
    );
}

function sequence(...items: Uint8Array[]): Uint8Array<ArrayBuffer> {
    return der(0x30, ...items);
}

function set(...items: Uint8Array[]): Uint8Array<ArrayBuffer> {
    return der(0x31, ...items);
}

function integer(value: number): Uint8Array<ArrayBuffer> {
    if (value < 0 || value > 127) {
        throw new Error('integer() only supports 0..127');
    }

    return der(
        0x02,
        Uint8Array.of(value),
    );
}

function utf8String(value: string): Uint8Array<ArrayBuffer> {
    return der(
        0x0c,
        new TextEncoder().encode(value),
    );
}

function printableString(value: string): Uint8Array<ArrayBuffer> {
    return der(
        0x13,
        new TextEncoder().encode(value),
    );
}

function oid(oidStr: string): Uint8Array<ArrayBuffer> {
    const parts = oidStr
        .split('.')
        .map(Number);

    const bytes: number[] = [];

    bytes.push(
        parts[0] * 40 + parts[1]
    );

    for (const n of parts.slice(2)) {
        const stack: number[] = [];

        let value = n;

        stack.unshift(value & 0x7f);
        value >>= 7;

        while (value > 0) {
            stack.unshift(
                (value & 0x7f) | 0x80
            );
            value >>= 7;
        }

        bytes.push(...stack);
    }

    return der(
        0x06,
        Uint8Array.from(bytes),
    );
}

function attribute(
    attr: CsrAttribute,
    value: string
): Uint8Array<ArrayBuffer> {

    const valueDer =
        attr === 'C'
            ? printableString(value)
            : utf8String(value);

    return set(
        sequence(
            oid(SUBJECT_OIDS[attr]),
            valueDer,
        ),
    );
}

function subject(
    args: Partial<Record<CsrAttribute, string>>
): Uint8Array<ArrayBuffer> {

    const rdns: Uint8Array<ArrayBuffer>[] = [];

    for (const attr of [
        'C',
        'ST',
        'L',
        'O',
        'OU',
        'CN',
    ] as const) {

        const value = args[attr];

        if (!value) {
            continue;
        }

        rdns.push(
            attribute(attr, value)
        );
    }

    return sequence(...rdns);
}

function bitString(
    bytes: Uint8Array
): Uint8Array<ArrayBuffer> {

    return der(
        0x03,
        Uint8Array.of(0x00),
        bytes,
    );
}

function pem(
    label: string,
    derBytes: Uint8Array
): string {

    const b64 = Buffer
        .from(derBytes)
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
        ),
    );

    const cri = sequence(
        integer(0),
        subject(args),

        // SubjectPublicKeyInfo
        spki,

        // attributes [0] IMPLICIT SET OF Attribute
        Uint8Array.of(
            0xa0,
            0x00,
        ),
    );

    const signature = new Uint8Array(
        await crypto.subtle.sign(
            'Ed25519',
            keyPair.privateKey,
            cri,
        ),
    );

    const csr = sequence(
        cri,

        // AlgorithmIdentifier
        sequence(
            oid('1.3.101.112'),
        ),

        bitString(signature),
    );

    return pem(
        'CERTIFICATE REQUEST',
        csr,
    );
}