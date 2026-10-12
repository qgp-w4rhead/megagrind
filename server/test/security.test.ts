import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.js'

const savedOrigins = process.env.ALLOWED_ORIGINS

afterEach(() => {
  if (savedOrigins === undefined) delete process.env.ALLOWED_ORIGINS
  else process.env.ALLOWED_ORIGINS = savedOrigins
})

describe('deployment boundaries', () => {
  it('reflects no cross-origin access when ALLOWED_ORIGINS is unset; same-origin requests unaffected', async () => {
    delete process.env.ALLOWED_ORIGINS
    const { app } = await createTestApp()

    const preflight = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeFalsy()

    const sameOrigin = await app.request('/api/health')
    expect(sameOrigin.status).toBe(200)
  })

  it('reflects only configured origins and rejects others', async () => {
    process.env.ALLOWED_ORIGINS = 'https://grind.example.com, https://admin.example.com'
    const { app } = await createTestApp()

    const allowed = await app.request('/api/health', {
      headers: { Origin: 'https://grind.example.com' },
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://grind.example.com')

    const rejected = await app.request('/api/health', {
      headers: { Origin: 'https://untrusted.example' },
    })
    expect(rejected.headers.get('access-control-allow-origin')).toBeFalsy()
  })

  it('rejects request bodies over the limit with 413 and accepts normal bodies', async () => {
    delete process.env.ALLOWED_ORIGINS
    const { app } = await createTestApp()

    const oversized = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'huge',
        type: 'work',
        start: 1,
        end: 2,
        description: 'x'.repeat(1024 * 1024 + 1),
      }),
    })
    expect(oversized.status).toBe(413)

    const normal = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'ok', type: 'work', start: 1, end: 2 }),
    })
    expect(normal.status).toBe(201)
  })
})
