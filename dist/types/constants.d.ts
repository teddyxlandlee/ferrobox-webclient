interface Side {
    webHost?: URL['hostname'];
    endpoints: {
        meta: string;
        data: string;
    };
}
interface DeployInfo {
    download: Side;
    upload: Side;
}
export declare const DEPLOY_INFO: DeployInfo;
export {};
