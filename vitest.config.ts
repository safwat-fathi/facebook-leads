import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/empty.ts', import.meta.url)), // the real package throws outside React Server Components
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
