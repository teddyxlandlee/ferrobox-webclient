import { defineConfig } from 'vite';
import path from 'path';
import 'dotenv/config'

function error(msg: string): never {
    throw new Error(msg)
}

export default defineConfig({
    root: path.resolve(__dirname),
    resolve: {
        alias: {
            'ferrobox-core': path.resolve(__dirname, 'node_modules/ferrobox-core/dist/index.mjs')
        }
    },
    optimizeDeps: {
        // exclude: ['ferrobox-core']
    },
    plugins: [],
    build: {
        outDir: path.resolve(__dirname, 'dist'),
        rolldownOptions: {
            input: {
                'static/download': './download.html',
                'static/upload': './upload.html',
                index: './download.html'
            }
        }
    },
    define: {
        DEPLOY_INFO: JSON.stringify({
            download: {
                endpoints: {
                    meta: process.env.META_ENDPOINT || error('META_ENDPOINT is not set'),
                    data: process.env.DATA_ENDPOINT || error('DATA_ENDPOINT is not set')
                }
            },
            upload: {
                endpoints: {
                    data: process.env.UPLOAD_DATA_ENDPOINT || error('UPLOAD_DATA_ENDPOINT is not set'),
                    meta: process.env.UPLOAD_META_ENDPOINT || error('UPLOAD_META_ENDPOINT is not set')
                }
            }
        })
    },
})