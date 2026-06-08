interface OSSCredentials {
    region: string
    accessKeyId: string
    accessKeySecret: string
    bucket: string
}

type Hashable = string | Uint8Array<ArrayBuffer> | ArrayBuffer

function bytesOf(input: Hashable): Uint8Array<ArrayBuffer> | ArrayBuffer {
    return typeof input === 'string' ? new TextEncoder().encode(input) : input
}

function hexOf(arrayBuffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(arrayBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

async function sha256Hash(content: Hashable): Promise<string> {
    const contentBytes = bytesOf(content)
    const hashBuffer: ArrayBuffer = await crypto.subtle.digest('SHA-256', contentBytes)
    return hexOf(hashBuffer)
}

async function hmacSha256(key: Hashable, content: Hashable): Promise<ArrayBuffer> {
    const keyBytes = bytesOf(key)
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const contentBytes = bytesOf(content)
    return crypto.subtle.sign('HMAC', cryptoKey, contentBytes)
}

export async function generatePresignedUrl(
    credentials: OSSCredentials,
    httpMethod: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    filename: string,
    expiration: number, // seconds
): Promise<URL> {
    const hostname = `${credentials.bucket}.${credentials.region}.aliyuncs.com`
    const now = new Date()
    // Guaranteed to be UTC time
    const nowTime: string = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const nowDate: string = nowTime.slice(0, 8)

    const queryParams = new URLSearchParams({
        // Keys are alphabetically sorted here
        'x-oss-additional-headers': 'host',
        'x-oss-credential': `${credentials.accessKeyId}/${nowDate}/${credentials.bucket}/oss/aliyun_v4_request`,
        'x-oss-date' /* sic */: nowTime,
        'x-oss-expires': '' + expiration,
        'x-oss-signature-version': 'OSS4-HMAC-SHA256',
    })
    queryParams.sort()

    const canonicalRequest: string = [
        // HTTP Verb
        httpMethod,
        // Canonical URI
        `/${credentials.bucket}/${filename}`,
        // Canonical Query String
        queryParams.toString(),
        // Canonical Headers
        `host:${hostname}`,
        // Additional Headers
        'host',
        // Hashed Payload
        'UNSIGNED-PAYLOAD',
    ].join('\n')

    const stringToSign = [
        'OSS4-HMAC-SHA256',
        nowTime,
        `${nowDate}/${credentials.bucket}/oss/aliyun_v4_request`,
        await sha256Hash(canonicalRequest),
    ].join('\n')

    const signingKey = await hmacSha256('aliyun_v4' + credentials.accessKeySecret, nowDate)
        .then(key => hmacSha256(key, credentials.region))
        .then(key => hmacSha256(key, 'oss'))
        .then(key => hmacSha256(key, 'aliyun_v4_request'))
    const signature = hexOf(await hmacSha256(signingKey, stringToSign))
    queryParams.set('x-oss-signature', signature)

    return new URL(`https://${hostname}/${filename}?${queryParams.toString()}`)
}
