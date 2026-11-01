import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': root,
      'server-only': path.resolve(root, 'tests/mocks/server-only.ts'),
    },
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'dom', include: ['tests/unit/**/*.test.tsx'], environment: 'jsdom' },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'html'],
    },
  },
});
