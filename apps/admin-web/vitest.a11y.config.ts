import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';

/**
 * The dedicated configuration for the browser accessibility gate.
 *
 * It is separate from `vitest.config.ts` on purpose. The ordinary suite runs in
 * jsdom, which has no layout engine: axe-core can compute names and roles there,
 * but `color-contrast` and `target-size` are exactly the checks that need real
 * geometry and real painted colours. This config enables Vitest Browser Mode with
 * the Playwright provider and headless Chromium, loads the same React plugin and
 * `@` alias the app uses, and keeps Tailwind in the pipeline so the utility
 * classes the primitives rely on are generated. Only the accessibility test is
 * included; nothing else runs twice.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // axe-core is CommonJS; pre-bundling it once keeps the first test from
  // triggering a mid-run dep-optimization reload.
  optimizeDeps: { include: ['axe-core'] },
  test: {
    include: ['src/tests/accessibility.test.tsx'],
    // Screenshots and `context.annotate` attachments are test output. Point them
    // at the git-ignored `dist` directory and skip failure screenshots entirely,
    // so a failing run cannot leave untracked image files beside the source.
    attachmentsDir: 'dist/.vitest-attachments',
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      screenshotDirectory: 'dist/__screenshots__',
      // A real desktop layout size, so target-size and contrast see the geometry
      // a browser actually produces rather than the jsdom default of nothing.
      // The accessibility fixtures are authored to fit within this height; a
      // taller fixture would be split rather than shrinking the viewport.
      viewport: { width: 1280, height: 1024 },
      instances: [
        {
          browser: 'chromium',
          viewport: { width: 1280, height: 1024 },
          screenshotFailures: false,
          screenshotDirectory: 'dist/__screenshots__',
        },
      ],
    },
  },
});
