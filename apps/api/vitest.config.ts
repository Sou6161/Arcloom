import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only ever run the TypeScript sources. Without this, compiled copies of the
    // tests under dist/ get collected too and every test runs twice.
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
