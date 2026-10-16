import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // The accessibility suite drives a real browser through axe-core and the
    // real stylesheet, so it runs only from vitest.a11y.config.ts. Excluding it
    // here keeps it out of the jsdom run in both directions.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/tests/accessibility.test.tsx'],
  },
});
