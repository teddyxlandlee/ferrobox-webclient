import {Buffer} from 'buffer'

interface ChallengeResult {
    response: AuthenticatorAssertionResponse,
    rawId: ArrayBuffer,
}

export async function challenge(id: string, challenge: ArrayBuffer): Promise<ChallengeResult> {
    const credential = await navigator.credentials.get({
        publicKey: {
            challenge,
            allowCredentials: [{
                id: Buffer.from(id, 'base64'),
                type: "public-key"
            }],
            userVerification: 'required',
        }
    })

    // implicit null check
    if (!(credential instanceof PublicKeyCredential)) {
        throw Error('WebAuthn authentication failed')
    }

    const response = credential.response as AuthenticatorAssertionResponse
    return { response, rawId: credential.rawId }
}

export async function listKeys(): Promise<readonly string[]> {
    // WebAuthn keys are managed by the browser/platform authenticator.
    // We can list credential IDs stored via `credentials.store()` in IndexedDB,
    // but the browser doesn't expose a direct API to enumerate all WebAuthn credentials.
    // Return an empty list; the credential-manager can maintain its own registry.
    return [];
}

/** @returns public key, in SPKI format */
export async function generateKeyPair(id: string): Promise<ArrayBuffer> {
    const publicKeyCredential = await navigator.credentials.create({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: window.location.hostname },
            user: {
                id: new TextEncoder().encode(id),
                name: id,
                displayName: id,
            },
            pubKeyCredParams: [
                { type: "public-key", alg: -8 },   // Ed25519
                { type: "public-key", alg: -7 },   // ES256
            ],
            authenticatorSelection: {
                userVerification: 'required',
            },
            attestation: 'none',
        },
    });

    if (!(publicKeyCredential instanceof PublicKeyCredential)) {
        throw Error('WebAuthn key generation failed');
    }

    const response = publicKeyCredential.response as AuthenticatorAttestationResponse;
    const publicKey = response.getPublicKey();
    if (!publicKey) {
        throw Error('WebAuthn did not return a public key');
    }

    return publicKey;
}