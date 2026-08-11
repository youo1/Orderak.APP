export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message || code);
  }
}

let csrfToken = '';

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

export async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes((init.method || 'GET').toUpperCase())) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text();
  if (!response.ok) {
    const payload = typeof data === 'object' && data ? data as Record<string, unknown> : {};
    if (response.status === 401) window.dispatchEvent(new Event('orderak:unauthorized'));
    throw new ApiError(
      response.status,
      String(payload.code || 'request_failed'),
      String(payload.detail || payload.title || payload.code || `Request failed (${response.status})`),
      data,
    );
  }
  return data as T;
}

export const format = {
  money(value: unknown) {
    const amount = Number(value || 0) / 100;
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(amount);
  },
  date(value: unknown, timezone = 'Africa/Cairo') {
    if (!value) return '—';
    const normalized = String(value).includes('T') ? String(value) : `${value}Z`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(normalized));
  },
};
