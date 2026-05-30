interface Side {
    webHost?: URL['hostname']
    endpoints: {
        meta: string
        data: string
    }
}

export declare const DEPLOY_INFO: {
    download: Side
    upload: Side
}