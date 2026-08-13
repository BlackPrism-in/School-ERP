/**
 * The only place the app talks to the network.
 *
 * `credentials: 'include'` matters: the session lives in an httpOnly cookie
 * the browser cannot read, which is exactly why there is no token handling
 * anywhere in this codebase. Nothing here stores credentials.
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export type FieldError = { path: string; message: string }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The session is gone or was never valid — the router should send them to sign in. */
  get isUnauthenticated() {
    return this.status === 401
  }

  get isPasswordChangeRequired() {
    return this.code === 'password_change_required'
  }

  fieldError(path: string): string | undefined {
    return this.fields.find((f) => f.path === path)?.message
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  signal?: AbortSignal
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body ? { 'content-type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch (cause) {
    // Distinguish "the server said no" from "we never reached the server".
    // A school on a flaky connection needs to be told which it is.
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.')
  }

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: FieldError[] } })
      ?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown_error',
      error?.message ?? 'Something went wrong.',
      error?.fields ?? [],
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
}
