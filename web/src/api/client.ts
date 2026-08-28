const API_BASE = '/api/v1';

class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isMutation = options?.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method);
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };
  if (isMutation) {
    headers['X-FileHelper-Request'] = '1';
  }
  
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: 'Request failed' } }));
    throw new ApiError(body.error?.code || 'UNKNOWN', body.error?.message || 'Request failed');
  }
  
  if (res.status === 204) return undefined as T;
  return res.json();
}

export { request, ApiError, API_BASE };