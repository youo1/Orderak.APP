import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Upload source maps to Sentry so stack traces are readable.
    // Set env vars: SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN.
    // Plugin is a no-op when SENTRY_AUTH_TOKEN is missing (local dev).
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            sourcemaps: {
              filesToDeleteAfterUpload: ['**/*.js.map'],
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        admin: path.resolve(__dirname, 'index.html'),
        preview: path.resolve(__dirname, 'theme-preview.html'),
      },
      output: {
        // Everything shipped as one 659 KB chunk, so the login screen could not
        // paint until the whole console had parsed, and a one-line change to any
        // feature page invalidated the bundle for every administrator on every
        // deploy.
        //
        // These three groups move on dependency bumps rather than on feature
        // work, which is what makes them worth separating: they stay cached
        // across the deploys that only touch src/features.
        //
        // The function form rather than the `{ name: [packages] }` map: the map
        // names entry points only, so a transitive dependency React cannot run
        // without — `scheduler` is the one that bites — lands back in the main
        // chunk and drags a re-download with it on every deploy. Matching on the
        // resolved module path catches the whole subtree.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
          if (id.includes('@tanstack')) return 'data-vendor';
          if (id.includes('@radix-ui')) return 'ui-vendor';
          return undefined;
        },
      },
    },
  },
})