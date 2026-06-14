import {AuthedUploadEngine, type AuthenticationField, type EncryptResult, type MetaOutV10, randomNamers, type UploadEngine} from "./upload-authed";
import {DEPLOY_INFO} from "./constants";
import {jwtDecode} from 'jwt-decode'
import {KeyHandle, signData, SignResult, listAllHandles} from "./authutil";
import * as FerroBox from 'ferrobox-core'

import './upload.css'

interface ChallengePayload {
    scopes: string[]
    nonce: string
}

type ChallengeResponse = {
    payload: string     // JWT
    signResult: SignResult
}

class CertificatedUploadEngine extends AuthedUploadEngine {
    private readonly authEndpoint: string = DEPLOY_INFO.upload.endpoints.auth
    private accessToken: string | null = null

    constructor(private readonly keyHandle: KeyHandle) {
        super(
            {
                metaUpload: DEPLOY_INFO.upload.endpoints.meta,
                dataUpload: DEPLOY_INFO.upload.endpoints.data,
                dataDownloadRoot: DEPLOY_INFO.download.endpoints.data,
            },
            randomNamers(/* meta/data lengths can be customized here */),
            {}
        );
    }

    private async sign(data: ChallengePayload): Promise<SignResult> {
        const signedString = [
            'v2',
            data.nonce,
            Array.from(data.scopes).sort().join(','),
        ].join('\n')
        return signData(this.keyHandle, signedString)
    }

    private async authenticate(): Promise<void> {
        const getResponse = await fetch(this.authEndpoint)
        const jwtPayload = await getResponse.text()
        // const payload = jwt.decode(jwtPayload) as ChallengePayload
        const payload: ChallengePayload = jwtDecode(jwtPayload)
        const signResult = await this.sign(payload)
        const challengeResponse: ChallengeResponse = {
            payload: jwtPayload,
            signResult,
        }
        const postResponse = await fetch(this.authEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(challengeResponse),
        })
        const {accessToken} = await postResponse.json()
        this.accessToken = accessToken
    }

    private async authAll() : Promise<AuthenticationField> {
        if (!this.accessToken) await this.authenticate()
        return 'Bearer ' + this.accessToken
    }

    protected authMeta = (meta: MetaOutV10) => this.authAll()

    protected authData = (data: EncryptResult) => this.authAll()
}

// ─── UI setup ──────────────────────────────────────────────────────────────

const fileInput = document.getElementById('file-input') as HTMLInputElement | null
const keyHandleSelect = document.getElementById('key-handle-select') as HTMLSelectElement | null
const uploadButton = document.getElementById('upload-button') as HTMLButtonElement | null
const statusMessage = document.getElementById('status-message') as HTMLDivElement | null

function setStatus(msg: string, isError: boolean = false): void {
    if (statusMessage) {
        statusMessage.textContent = msg
        statusMessage.style.color = isError ? '#c00' : '#080'
    }
}

async function populateKeyHandles(): Promise<void> {
    if (!keyHandleSelect) return

    const handles = await listAllHandles()

    keyHandleSelect.innerHTML = ''

    if (handles.length === 0) {
        const option = document.createElement('option')
        option.disabled = true
        option.selected = true
        option.textContent = 'No keys found \u2013 register a key first'
        keyHandleSelect.appendChild(option)
        if (uploadButton) uploadButton.disabled = true
        return
    }

    for (const handle of handles) {
        const option = document.createElement('option')
        option.value = JSON.stringify(handle)
        option.textContent = `${handle.type}: ${handle.id}`
        keyHandleSelect.appendChild(option)
    }

    if (uploadButton) uploadButton.disabled = false
}

async function handleUpload(): Promise<void> {
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        setStatus('Please select a file first', true)
        return
    }

    if (!keyHandleSelect || !keyHandleSelect.value) {
        setStatus('Please select a key handle', true)
        return
    }

    const file = fileInput.files[0]
    const keyHandle: KeyHandle = JSON.parse(keyHandleSelect.value)

    setStatus('Uploading…')

    try {
        const engine: UploadEngine = new CertificatedUploadEngine(keyHandle)

        const slug = await FerroBox.upload(file, engine)

        setStatus(`Upload complete! Slug: ${slug}`)
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setStatus(`Upload failed: ${msg}`, true)
    }
}

async function init(): Promise<void> {
    await populateKeyHandles()

    if (uploadButton) {
        uploadButton.addEventListener('click', handleUpload)
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                setStatus(`Selected: ${fileInput.files[0].name}`)
            }
        })
    }

    setStatus('Ready')
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
} else {
    init()
}
