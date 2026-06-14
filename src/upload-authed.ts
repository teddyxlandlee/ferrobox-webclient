import * as FerroBox  from 'ferrobox-core'
import {nanoid} from 'nanoid'
// import type {MetaUploadRequest, DataUploadRequest} from "ferrobox-core/types";

export type UploadEngine = Parameters<typeof FerroBox.upload>[1]
type MetaUploadRequest = UploadEngine['uploadMeta']
type DataUploadRequest = UploadEngine['uploadData']

export type MetaOutV10 = Parameters<MetaUploadRequest>[0]
export type EncryptResult = Parameters<DataUploadRequest>[0]

export type AuthenticationField = string
type URI = typeof URL.prototype.href

type Namers = {
    meta: (meta: MetaOutV10) => Promise<string>
    data: (data: EncryptResult) => Promise<string>
}

export function randomNamer(length?: number): (input: any) => Promise<string> {
    return async (_input: any) => nanoid(length)
}
export function randomNamers(metaLength?: number, dataLength?: number): Namers {
    return {
        meta: randomNamer(metaLength),
        data: randomNamer(dataLength),
    }
}

const ENABLE_REQUEST_STREAMS: boolean = false
const supportsRequestStreams = () => {
    /* https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests */
    let duplexAccessed = false;

    const hasContentType = new Request('', ({
        body: new ReadableStream(),
        method: 'POST',
        get duplex() {
            duplexAccessed = true;
            return 'half';
        },
    } as RequestInit)).headers.has('Content-Type');

    return duplexAccessed && !hasContentType;
}

async function wrapRequestBody(stream: ReadableStream<any>): Promise<BodyInit> {
    if (ENABLE_REQUEST_STREAMS && supportsRequestStreams()) return stream
    return new Response(stream).blob()
}

export abstract class AuthedUploadEngine implements UploadEngine {
    private readonly maxRetries: number
    // Only retry auth server, not storage server
    private readonly retryPredicate: (response: Response) => Promise<boolean>

    protected constructor(
        private readonly endpoints: {
            metaUpload: URI
            dataUpload: URI
            dataDownloadRoot: URI
        },
        private readonly namers: Namers,
        options?: {
            maxRetries?: number,
            retryPredicate?: (response: Response) => Promise<boolean>,
        }
    ) {
        this.maxRetries = options?.maxRetries ?? 3
        this.retryPredicate = options?.retryPredicate ?? (async (response) => {
            // By default, retry only on token expiry
            return response.status === 401
        })
    }

    protected abstract authMeta(meta: MetaOutV10): Promise<AuthenticationField>
    protected abstract authData(data: EncryptResult): Promise<AuthenticationField>

    private async uploadVia<T>(
        authServer: URI, data: T,
        bodyConstructor: (data: T) => BodyInit | Promise<BodyInit>,
        contentType: string,
        authProvider: (data: T) => Promise<AuthenticationField>,
        namer: (data: T) => Promise<string>,
        retries: number = 0,
    ): Promise<string> {
        if (retries >= this.maxRetries) {
            throw new Error('Max retries reached')
        }

        const authField = await authProvider(data)
        const name = await namer(data)
        // POST a `slug` (not URI directly) to metaUpload server for a signatured URL
        const url = new URL(authServer)
        const authServerResponse = await fetch(url.href, {
            method: 'POST',
            headers: {
                'Authorization': authField
            },
            body: JSON.stringify({
                slug: name
            })
        })
        if (!authServerResponse.ok) {
            if (await this.retryPredicate(authServerResponse)) {
                // authorization credentials may be outdated
                return this.uploadVia(authServer, data, bodyConstructor, contentType, authProvider, namer, retries + 1)
            }

            const errorText = await authServerResponse.text()
            throw new Error(`${errorText} [${authServerResponse.status} ${authServerResponse.statusText}]`)
        }
        const res = await authServerResponse.json()
        if (typeof res.url !== 'string') {
            throw new Error('No URL returned from metaUpload server')
        }
        let body = bodyConstructor(data)
        if (body instanceof Promise) {
            body = await body
        }

        const storageResponse = await fetch(res.url, {
            method: 'PUT',
            body,
            headers: {
                'content-type': contentType,
            },
        })
        if (!storageResponse.ok) {
            throw new Error('Failed to upload meta to storage server: ' + await storageResponse.text())
        }
        return name
    }

    async uploadMeta(meta: MetaOutV10): Promise<string> {
        return this.uploadVia(
            this.endpoints.metaUpload,
            meta, JSON.stringify,
            'application/json',
            this.authMeta, this.namers.meta,
        )
    }
    async uploadData(data: EncryptResult): Promise<string> {
        const slug = await this.uploadVia(
            this.endpoints.dataUpload,
            data, (d) => wrapRequestBody(d.encodedStream),
            'application/octet-stream',
            this.authData, this.namers.data,
        )
        return new URL(slug, this.endpoints.dataDownloadRoot).href
    }
}