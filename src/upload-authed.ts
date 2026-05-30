import * as FerroBox  from 'ferrobox-core'
import {nanoid} from 'nanoid'
// import type {MetaUploadRequest, DataUploadRequest} from "ferrobox-core/types";

type UploadEngine = Parameters<typeof FerroBox.upload>[1]
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
        bodyConstructor: (data: T) => string | ReadableStream,
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
                return this.uploadVia(authServer, data, bodyConstructor, authProvider, namer, retries + 1)
            }

            const errorText = await authServerResponse.text()
            throw new Error(`${errorText} [${authServerResponse.status} ${authServerResponse.statusText}]`)
        }
        const res = await authServerResponse.json()
        if (typeof res.url !== 'string') {
            throw new Error('No URL returned from metaUpload server')
        }

        const storageResponse = await fetch(res.url, {
            method: 'PUT',
            body: bodyConstructor(data),
        })
        if (!storageResponse.ok) {
            throw new Error('Failed to upload meta to storage server: ' + await storageResponse.text())
        }
        return name
    }

    async uploadMeta(meta: MetaOutV10): Promise<string> {
        return this.uploadVia(this.endpoints.metaUpload, meta, JSON.stringify, this.authMeta, this.namers.meta)
    }
    async uploadData(data: EncryptResult): Promise<string> {
        return this.uploadVia(this.endpoints.dataUpload, data, (d) => d.encodedStream, this.authData, this.namers.data)
    }
}