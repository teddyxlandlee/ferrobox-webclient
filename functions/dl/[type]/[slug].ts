import OSS from 'ali-oss';

interface FerroboxFunctionsEnvironment {
    OSS_BUCKET_META: string
    OSS_BUCKET_DATA: string
    OSS_REGION: string
    OSS_ACCESS_KEY_ID: string
    OSS_ACCESS_KEY_SECRET: string
}

const THRESHOLD_SIZE = 50 * 1024 * 1024
const PRESIGNED_URL_EXPIRATION = 60 * 15 // 15 minutes

export const onRequestGet: PagesFunction<FerroboxFunctionsEnvironment> = async (context) => {
    const { type, slug } = context.params;
    if ((type !== 'meta' && type !== 'data') || typeof slug !== 'string' || slug.length === 0) {
        return new Response('Invalid request path', { status: 400 });
    }
    const bucket = context.env[type === 'meta' ? 'OSS_BUCKET_META' : 'OSS_BUCKET_DATA'];
    const region = context.env.OSS_REGION;
    const accessKeyId = context.env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = context.env.OSS_ACCESS_KEY_SECRET;

    const filename = slug + (type === 'meta' ? '.json' : '.bin')

    const client = new OSS({
        region,
        accessKeyId,
        accessKeySecret,
        bucket,
        secure: true,   // Force HTTPS is enabled on the buckets
    })

    // HEAD it initially to check whether file size exceeds threshold
    // If it does, we will generate a signed URL and redirect the client to it
    let fileSize: number
    try {
        const headResult = await client.head(filename)
        fileSize = headResult.res.size
    } catch (err) {
        if (err instanceof Error && err.name === 'NoSuchKeyError') {
            return new Response('File not found', { status: 404 });
        } else {
            return new Response(String(err), { status: 502 })
        }
    }

    const url = await client.signatureUrlV4('GET', PRESIGNED_URL_EXPIRATION, {}, filename)
    if (fileSize > THRESHOLD_SIZE) {
        // make a presigned URL valid for 15 minutes
        return Response.redirect(url, 302)
    }

    const response = await fetch(url)
    return filterHeaders(response)
}

function filterHeaders(response: Response): Response {
    const newHeaders = new Headers(response.headers)
    for (const key of response.headers.keys()) {
        const lower = key.toLowerCase()
        if (lower.startsWith('x-oss-') || lower === 'last-modified') {
            newHeaders.delete(key)
        }
    }
    newHeaders.append('Via', 'FerroBox Functions (Cloudflare Pages)')

    return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
    })
}
