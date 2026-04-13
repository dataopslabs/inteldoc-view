import { defineConfig } from 'vitest/config';
import path from 'path';

const uiRoot = path.resolve(__dirname, '.');

export default defineConfig({
  test: {
    root: uiRoot,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      thresholds: {
        lines: 70,
        functions: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(uiRoot, 'src'),
    },
  },
});
