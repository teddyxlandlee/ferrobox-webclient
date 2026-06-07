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
