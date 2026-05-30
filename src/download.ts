import { downloadFromUrl } from './download-logic';
import { saveAs } from 'file-saver';

/**
 * 检查是否支持 File System Access API
 */
function isFileSystemApiSupported(): boolean {
    return 'showSaveFilePicker' in window;
}

/**
 * 使用 File System API 进行流式下载（推荐）
 */
async function streamDownloadWithFileSystemApi(stream: ReadableStream, fileName: string): Promise<void> {
    try {
        // 1. 请求用户授权保存位置
        const fileHandle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
                description: 'All files',
                accept: { '*/*': [] },
            }],
        });

        // 2. 创建可写流
        const writableStream = await fileHandle.createWritable();

        // 3. 使用管道传输数据（自动处理背压）
        await stream.pipeTo(writableStream);

        console.log('File downloaded successfully using File System API!');
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error('User cancelled the save operation');
        }
        throw err;
    }
}

/**
 * 降级方案：使用 file-saver 库下载
 */
async function downloadWithFallback(stream: ReadableStream, fileName: string): Promise<void> {
    // 使用 Response 对象包装流并转换为 Blob
    const response = new Response(stream);
    const blob = await response.blob();

    // 使用 file-saver 库的 saveAs 函数
    saveAs(blob, fileName);

    console.log('File downloaded using file-saver fallback method');
}

/**
 * 显示完成消息
 */
function showComplete(): void {
    const container = document.querySelector('.container');
    if (container) {
        container.innerHTML = `
            <div style="text-align: center;">
                <div style="
                    width: 60px;
                    height: 60px;
                    margin: 0 auto 20px;
                    background-color: #4caf50;
                    border-radius: 50%;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                ">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
                        <path d="M5 13l4 4L19 7"/>
                    </svg>
                </div>
                <h1 style="color: #333;">Download Complete!</h1>
                <p style="color: #666;">Your file has been saved successfully.</p>
            </div>
        `;
    }
}

/**
 * 主下载处理函数
 */
async function handleDownload(): Promise<void> {
    try {
        const result = await downloadFromUrl(window.location);

        if (result.success) {
            // 获取文件名（路径格式: /type/slug）
            const urlParts = window.location.pathname.split('/');
            const slug = urlParts[2];
            const fileName = slug ? slug : 'download';

            // 尝试使用 File System API，不可用时降级
            if (isFileSystemApiSupported()) {
                try {
                    await streamDownloadWithFileSystemApi(result.stream, fileName);
                    showComplete();
                    return;
                } catch (err) {
                    // 用户取消或 API 出错，降级到传统方式
                    console.warn('File System API failed, falling back:', err);
                }
            }

            // 降级方案：使用 file-saver
            await downloadWithFallback(result.stream, fileName);
            showComplete();
        } else {
            console.error('Download failed:', result.error);
            showError(result.error);
        }
    } catch (error) {
        console.error('Unexpected error during download:', error);
        showError(String(error));
    }
}

function showError(message: string): void {
    document.body.innerHTML = `
        <div style="
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background-color: #f5f5f5;
        ">
            <div style="
                background-color: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                max-width: 500px;
                text-align: center;
            ">
                <h2 style="color: #d32f2f;">Download Error</h2>
                <p>${message}</p>
                <button onclick="history.back()" style="
                    margin-top: 15px;
                    padding: 10px 20px;
                    background-color: #1976d2;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                ">Go Back</button>
            </div>
        </div>
    `;
}

// 页面加载完成后开始下载
document.addEventListener('DOMContentLoaded', handleDownload);
