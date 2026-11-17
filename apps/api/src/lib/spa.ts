import { join } from 'node:path'
import type { BunFile } from 'bun'
import { Elysia } from 'elysia'

/**
 * Serves a Vite build directory. Factory instead of a module singleton so tests can point it
 * at a fixture directory.
 */
export function createSpa(distDir: string) {
  const indexPath = join(distDir, 'index.html')
  const assetsDir = join(distDir, 'assets')

  /**
   * Hashed build output. Explicit Responses so a 404 does not fall through to the NOT_FOUND
   * handler (which is busy answering SPA deep links).
   */
  const spaAssets = new Elysia({ name: 'spa-assets' }).get('/assets/*', ({ request, status }) => {
    const relative = safeDecode(new URL(request.url).pathname).replace(/^\/?assets\//, '')
    if (!relative || relative.includes('..')) return status(404, { message: 'Not found' })

    const file = Bun.file(join(assetsDir, relative))
    if (file.size === 0) return status(404, { message: 'Not found' })

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
  const serveSpaIndex = async (): Promise<Response> => {
    const indexHtml = Bun.file(indexPath)
    if (!(await indexHtml.exists())) {
      return new Response('Web app not built. Run `bun run build` first.', { status: 503 })
    }
    return new Response(indexHtml as BunFile, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    })
  }

  return { spaAssets, serveSpaIndex }
}

export function safeDecode(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return ''
  }
}
