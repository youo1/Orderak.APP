import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { AuthProvider } from '@/features/auth/auth-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '../index.css'
import App from './App.tsx'

// Sentry: error monitoring with sourcemap support.
// Set the DSN via VITE_SENTRY_DSN env var (e.g. in .env.production).
// In Cloudflare Pages this is set as a build environment variable.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,
});

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })

window.addEventListener('orderak:theme-published', (event) => {
  const hash = (event as CustomEvent<{ hash?: string }>).detail?.hash;
  const link = document.querySelector<HTMLLinkElement>('#orderak-theme-stylesheet');
  if (link && hash) link.href = `/theme.css?v=${encodeURIComponent(hash)}`;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
