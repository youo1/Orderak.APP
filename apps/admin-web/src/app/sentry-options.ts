import * as Sentry from '@sentry/react'

// What the admin console sends to Sentry, apart from the DSN.
//
// Sentry 11 collects URL query values, request and response bodies, headers,
// cookies and the visitor's IP address unless it is told not to. The admin
// API's requests and responses carry seller and buyer phone numbers, order
// history and support tickets, so every category that can hold them is
// switched off. An error report keeps its stack trace, the page path and the
// browser's user agent. The console's own paths carry ids, not phone numbers.
//
// src/tests/sentry-data-collection.test.ts fails if a query value in the URL,
// or the visitor's IP address, reaches Sentry.
export const ADMIN_SENTRY_OPTIONS: Sentry.BrowserOptions = {
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ['user-agent'] }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
}
