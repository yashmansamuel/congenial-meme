import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const htmlEntries = Object.fromEntries(
  readdirSync(root)
    .filter((file) => file.endsWith('.html'))
    .map((file) => [
      file.replace(/\.html$/, ''),
      resolve(root, file),
    ])
);

export default defineConfig({
  root,
  appType: 'mpa',
  publicDir: resolve(root, 'public'),

  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    sourcemap: false,

    rollupOptions: {
      input: htmlEntries,

      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  server: {
    host: true,
    port: 5173,
  },

  preview: {
    host: true,
    port: 4173,
  },
});
