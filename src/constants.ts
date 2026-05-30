interface Side {
    webHost?: URL['hostname']
    endpoints: {
        meta: string
        data: string
    }
}

interface DeployInfo {
    download: Side
    upload: Side & {
        endpoints: { auth: string }
    }
}

function error(msg: string): never {
    throw new Error(msg)
}

export const DEPLOY_INFO: DeployInfo = {
    download: {
        endpoints: {
            meta: import.meta.env.VITE_META_ENDPOINT || error('META_ENDPOINT is not set'),
            data: import.meta.env.VITE_DATA_ENDPOINT || error('DATA_ENDPOINT is not set'),
        }
    },
    upload: {
        endpoints: {
            data: import.meta.env.VITE_UPLOAD_DATA_ENDPOINT || error('UPLOAD_DATA_ENDPOINT is not set'),
            meta: import.meta.env.VITE_UPLOAD_META_ENDPOINT || error('UPLOAD_META_ENDPOINT is not set'),
            auth: import.meta.env.VITE_UPLOAD_AUTH_ENDPOINT || error('UPLOAD_AUTH_ENDPOINT is not set'),
        }
    }
}