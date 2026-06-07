import {AuthedUploadEngine, AuthenticationField, EncryptResult, MetaOutV10, randomNamers} from "./upload-authed";
import {DEPLOY_INFO} from "./constants";
import * as jwt from 'jsonwebtoken'
import {KeyHandle, signData, SignResult} from "./authutil";

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
        const payload = jwt.decode(jwtPayload) as ChallengePayload
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