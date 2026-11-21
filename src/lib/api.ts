const TOKEN_KEY = 'sgn_committee_auth_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export async function apiRequest<T = any>(
  path: string,
  options: { method?: string; body?: unknown; skipAuth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (!options.skipAuth) {
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const message = typeof data === 'object' && data && 'error' in data ? String((data as any).error) : `Request failed (${res.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return data as T;
}

export function subscribeToLiveUpdates(onEvent: (eventType: string) => void): () => void {
  const token = getAuthToken();
  if (!token) return () => {};
  const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  es.onmessage = (evt) => {
    try {
      const parsed = JSON.parse(evt.data);
      if (parsed.eventType && parsed.eventType !== 'connected') {
        onEvent(parsed.eventType);
      }
    } catch {
      // Ignore heartbeat parse errors
    }
  };
  return () => es.close();
}
