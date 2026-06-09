import { defineConfig } from 'vite';
import path from 'path';
import 'dotenv/config'

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
            input: [
                'static/download.html',
                'static/upload.html',
                'static/credentials.html',
            ],
        },
        sourcemap: true,
    },
})