import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './client'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  fetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('request shape', () => {
  it('always sends credentials so the httpOnly session cookie travels', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await api.get('/health')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
  })

  it('drops undefined and empty query values instead of sending them', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))
    await api.get('/students', { q: 'aarav', status: undefined, sectionId: '', page: 2 })

    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('q=aarav')
    expect(url).toContain('page=2')
    expect(url).not.toContain('status=')
    expect(url).not.toContain('sectionId=')
  })

  it('sends no content-type on a bodyless request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await api.post('/auth/logout')
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual({})
  })
})

describe('error handling', () => {
  it('turns an API error envelope into an ApiError with its code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'overpayment', message: 'That is more than owed.' } }, 400),
    )

    await expect(api.post('/fees/collect', {})).rejects.toMatchObject({
      status: 400,
      code: 'overpayment',
      message: 'That is more than owed.',
    })
  })

  it('exposes field errors individually', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'validation_failed',
            message: 'Some fields need attention.',
            fields: [{ path: 'admissionNo', message: 'Required' }],
          },
        },
        400,
      ),
    )

    const error = await api.post('/students', {}).catch((e) => e as ApiError)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).fieldError('admissionNo')).toBe('Required')
    expect((error as ApiError).fieldError('firstName')).toBeUndefined()
  })

  /**
   * A school on a flaky connection needs "we could not reach the server", not
   * a generic failure that looks like the server rejected them.
   */
  it('distinguishes a network failure from a server rejection', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await api.get('/students').catch((e) => e as ApiError)
    expect((error as ApiError).code).toBe('network_error')
    expect((error as ApiError).status).toBe(0)
    expect((error as ApiError).message).toContain('Could not reach the server')
  })

  it('flags an unauthenticated response so the router can redirect once', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'nope' } }, 401))
    const error = await api.get('/auth/me').catch((e) => e as ApiError)
    expect((error as ApiError).isUnauthenticated).toBe(true)
  })

  it('flags a forced password change distinctly from a plain 403', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'password_change_required', message: 'change it' } }, 403),
    )
    const error = await api.get('/students').catch((e) => e as ApiError)
    expect((error as ApiError).isPasswordChangeRequired).toBe(true)
    expect((error as ApiError).isUnauthenticated).toBe(false)
  })

  it('survives an error response with no parseable body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)

    const error = await api.get('/health').catch((e) => e as ApiError)
    expect((error as ApiError).status).toBe(502)
    expect((error as ApiError).code).toBe('unknown_error')
  })

  it('returns undefined for 204 rather than trying to parse a body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response)
    await expect(api.delete('/students/x')).resolves.toBeUndefined()
  })
})
