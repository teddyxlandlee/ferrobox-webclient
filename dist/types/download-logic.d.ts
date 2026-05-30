type DownloadResult = {
    success: true;
    stream: ReadableStream;
} | {
    success: false;
    error: string;
};
export declare function downloadFromUrl(url: URL | Location): Promise<DownloadResult>;
export {};
