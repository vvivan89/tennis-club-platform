import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': root,
      'server-only': path.resolve(root, 'tests/mocks/server-only.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [['tests/unit/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./tests/setup.ts'],
    minWorkers: 1,
    maxWorkers: 1,
    pool: 'vmForks',
    poolOptions: {
      vmForks: {
        memoryLimit: '512MB',
      },
    },
    coverage: {
      provider: 'v8',
      all: true,
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'html'],
    },
  },
});
