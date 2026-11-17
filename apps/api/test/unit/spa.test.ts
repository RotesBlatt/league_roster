import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { createSpa, safeDecode } from '../../src/lib/spa.ts'

let dist: string
let spa: ReturnType<typeof createSpa>
const buildServer = () => new Elysia().use(spa.spaAssets).listen(0)
let server: ReturnType<typeof buildServer>
let base: string

/**
 * `app.handle(request)` does not route in this Elysia build, so the plugin is served over an
 * ephemeral port like any real request.
 */
async function call(path: string): Promise<Response> {
  return fetch(`${base}${path}`)
}

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'lol-spa-'))
  mkdirSync(join(dist, 'assets'), { recursive: true })
  await Bun.write(join(dist, 'index.html'), '<!doctype html><div id="root"></div>')
  await Bun.write(join(dist, 'assets', 'index-abc123.js'), 'console.log("app")')

  spa = createSpa(dist)
  server = buildServer()
  const port = (server.server as { port?: number } | undefined)?.port
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server.stop()
  rmSync(dist, { recursive: true, force: true })
})

describe('spaAssets', () => {
  test('serves an existing asset with an immutable cache header', async () => {
    const res = await call('/assets/index-abc123.js')

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toContain('console.log')
  })

  test('missing file is a JSON 404, not the SPA shell', async () => {
    const res = await call('/assets/nope.js')

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ message: 'Not found' })
  })

  test('rejects path traversal', async () => {
    expect((await call('/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status).toBe(404)
  })
})

describe('serveSpaIndex', () => {
  test('serves the shell for client-side routes', async () => {
    const res = await spa.serveSpaIndex()

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toContain('id="root"')
  })

  test('explains itself when the SPA was never built', async () => {
    const unbuilt = createSpa(join(dist, 'does-not-exist'))
    const res = await unbuilt.serveSpaIndex()

    expect(res.status).toBe(503)
    expect(await res.text()).toContain('bun run build')
  })
})

describe('safeDecode', () => {
  test('decodes percent escapes', () => {
    expect(safeDecode('/assets/a%20b.js')).toBe('/assets/a b.js')
  })

  test('returns empty string instead of throwing on malformed input', () => {
    expect(safeDecode('/%E0%A4%A')).toBe('')
  })
})
