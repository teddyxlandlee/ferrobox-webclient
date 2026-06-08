import * as FerroBox  from 'ferrobox-core'
import {DEPLOY_INFO} from "./constants";
import {Buffer} from 'buffer'

const VERIFY_HOSTNAME = false

type DownloadResult = {
    success: true,
    stream: ReadableStream
} | {
    success: false,
    error: string
}

const disallowedPathType: readonly string[] = [
    'static'
] as const

const allowedPathType: readonly string[] = [
    'f', 'file',
    'p', 'plaintext',
    'm', 'markdown',
] as const

function isPathValid(pathType: string): boolean {
    return allowedPathType.includes(pathType) && !disallowedPathType.includes(pathType)
}

export async function downloadFromUrl(url: URL | Location): Promise<DownloadResult> {
    if (VERIFY_HOSTNAME && url.hostname !== DEPLOY_INFO.download.webHost) {
        return {
            success: false,
            error: 'Hostname does not match expected webHost'
        }
    }
    const [pathType, slug, waste] = url.pathname.substring(1).split('/', 3)
    if (!isPathValid(pathType) || waste) {
        return {
            success: false,
            error: 'Invalid path type or slug'
        }
    }
    try {
        const key: Uint8Array = Buffer.from(url.hash.substring(1), 'base64')
        const meta = await fetchMeta(slug)
        // use default download options for Data
        const result = await FerroBox.download(meta, key)
        return {
            success: true,
            stream: result
        }
    } catch (error) {
        return {
            success: false,
            error: String(error)
        }
    }
}

async function fetchMeta(slug: string): Promise<Parameters<typeof FerroBox.download>[0]> {
    const url = new URL(slug, DEPLOY_INFO.download.endpoints.meta)
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.status} ${response.statusText}`)
    }
    return await response.json()
}
