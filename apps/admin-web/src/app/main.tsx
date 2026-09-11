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
//
// Session Replay is deliberately NOT enabled here, and its absence is the
// decision rather than an omission.
//
// It was configured and could never transmit: public/_headers sets
// `connect-src 'self'` and declares no `worker-src blob:`, so the Content
// Security Policy blocked both the ingest request and the compression worker
// replay builds from a blob URL. Nothing was reaching Sentry from this app at
// all, and the silence read as "no frontend errors".
//
// Fixing that meant choosing what to admit through the CSP, and replay is the
// wrong thing to admit on this surface. This is the admin panel: its screens
// show seller phone numbers, buyer phone numbers, order history and support
// ticket contents, and a replay records all of it as rendered. Errors and
// traces carry stack frames and request metadata, which is what an operator
// actually needs to debug the panel. So the ingest origin is allowlisted for
// those, and replay stays off.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
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
