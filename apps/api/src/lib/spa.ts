import { join } from 'node:path'
import type { BunFile } from 'bun'
import { Elysia } from 'elysia'
import { env } from '../env.ts'

const indexHtml = Bun.file(join(env.webDist, 'index.html'))
const assetsDir = join(env.webDist, 'assets')

const notFound = () =>
  new Response(JSON.stringify({ message: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })

/**
 * Serves hashed build output. Uses explicit Responses so a 404 does not fall through to the
 * NOT_FOUND handler (which is busy answering SPA deep links).
 */
export const spaAssets = new Elysia({ name: 'spa-assets' }).get('/assets/*', ({ request }) => {
  const relative = safeDecode(new URL(request.url).pathname).replace(/^\/?assets\//, '')
  if (!relative || relative.includes('..')) return notFound()

  const file = Bun.file(join(assetsDir, relative))
  if (file.size === 0) return notFound()

  return new Response(file as BunFile, {
    status: 200,
    // content-hashed file names, safe to cache forever
    headers: { 'cache-control': 'public, max-age=31536000, immutable' },
  })
})

/**
 * History-API fallback: any non-/api, non-/assets path that no route matched renders the SPA
 * shell, so /roster survives a hard refresh. Called from the global NOT_FOUND handler.
 */
export async function serveSpaIndex(): Promise<Response> {
  if (!(await indexHtml.exists())) {
    return new Response('Web app not built. Run `bun run build` first.', { status: 503 })
  }
  return new Response(indexHtml as BunFile, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  })
}

function safeDecode(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return ''
  }
}
