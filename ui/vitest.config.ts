import { defineConfig } from 'vitest/config';
import path from 'path';

const uiRoot = path.resolve(__dirname, '.');

export default defineConfig({
  test: {
    root: uiRoot,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(uiRoot, 'src'),
    },
  },
});
