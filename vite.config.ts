import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome120',
    rolldownOptions: {
      input: {
        background: resolve('src/background/index.ts'),
        options: resolve('src/options/index.html'),
        popup: resolve('src/popup/index.html'),
        regex: resolve('src/utils/regex.ts'),
      },
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
