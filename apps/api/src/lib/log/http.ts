import type { Fields, Level, Logger } from './logger.ts'

export type RequestLogOptions = {
  logger: Logger
  /** monotonic-ish ms source; tests inject it so durations are deterministic */
  clock?: () => number
  /** mark requests slower than this (default 500ms) */
  slowMs?: number
  /** log served `/assets/*` at info instead of debug */
  logAssets?: boolean
  /** id generator; tests pin it */
  generateId?: () => string
}

/** The slice of an Elysia context these hooks touch. */
type SetLike = { status?: number | string; headers: Record<string, string | number> }
type BaseContext = { request: Request; set: SetLike }

type Pending = {
  id: string
  method: string
  path: string
  startedAt: number
  ip?: string
  ua?: string
  userId?: string
  role?: string
  membership?: string
  errorCode?: string
  error?: unknown
  message?: string
}

/** Accept an inbound id only if it cannot inject into the log line. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/

const HEX = '0123456789abcdef'

function defaultId(): string {
  let id = ''
  for (let i = 0; i < 8; i += 1) id += HEX[Math.floor(Math.random() * 16)]
  return id
}

export function levelForStatus(status: number): Level {
  if (status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

function statusOf(response: unknown, set: SetLike): number {
  if (response instanceof Response) return response.status
  const numeric = Number(set.status)
  return Number.isFinite(numeric) && numeric >= 100 ? numeric : 200
}

function messageOf(value: unknown): string | undefined {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value) {
    return typeof value.message === 'string' ? value.message : undefined
  }
  return undefined
}

/**
 * The browser-facing message of a failed request. Elysia hands `onAfterResponse` a `Response`
 * for guard denials and validation errors, so read the (cloned) JSON body — never the whole
 * body, and only the `message` field, which the client already received.
 */
/**
 * A guard/handler that returns `status(403, …)` leaves an `ElysiaCustomStatusResponse` here, and
 * its body is the only place the API's own message is available. Response bodies are deliberately
 * not read: consuming a stream after the fact is not worth it, and `app.onError` already passes
 * its own message. Keeping this synchronous also keeps log lines in request order.
 */
function messageFromResponse(response: unknown): string | undefined {
  if (response && typeof response === 'object' && 'response' in response) {
    return messageOf(response.response)
  }
  return messageOf(response)
}

function ipOf(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || undefined
  return request.headers.get('x-real-ip') ?? undefined
}

/**
 * Request/response logging for Elysia. Returns plain hook functions (not a plugin: hooks inside a
 * `.use()`d plugin do not fire `onAfterResponse`, and a plugin added twice runs `onRequest` twice).
 *
 * State lives in a `WeakMap<Request, Pending>` because derived context is gone in
 * `onAfterResponse`. Request-scoped by construction — no `store` mutation that could leak.
 */
export function createRequestLog(options: RequestLogOptions) {
  const { logger } = options
  const clock = options.clock ?? (() => Date.now())
  const slowMs = options.slowMs ?? 500
  const logAssets = options.logAssets ?? false
  const generateId = options.generateId ?? defaultId
  const pending = new WeakMap<Request, Pending>()

  function emit(
    request: Request,
    record: Pending,
    status: number,
    message: string | undefined,
  ): void {
    pending.delete(request)
    const ms = Math.round(clock() - record.startedAt)
    const isAsset = record.path.startsWith('/assets/')
    const level: Level = isAsset && !logAssets ? 'debug' : levelForStatus(status)

    const fields: Fields = {
      id: record.id,
      method: record.method,
      path: record.path,
      status,
      ms,
    }
    if (record.userId !== undefined) fields.userId = record.userId
    if (record.role !== undefined) fields.role = record.role
    if (record.membership !== undefined) fields.membership = record.membership
    if (record.ip !== undefined) fields.ip = record.ip
    if (record.ua !== undefined) fields.ua = record.ua
    if (ms > slowMs) fields.slow = true
    // A NOT_FOUND that became the SPA shell is a 200; a 422 is the caller's fault, not a stack
    // worth keeping. Only a failure status carries an error code, and only a 5xx the stack.
    if (status >= 400 && record.errorCode !== undefined) fields.errorCode = record.errorCode
    if (status >= 500 && record.error !== undefined) fields.error = record.error
    if (status >= 400) {
      // The message the browser saw: from the response when Elysia exposes it, otherwise the
      // one the onError handler passed in. Never the raw error text.
      const text = message ?? record.message
      if (text !== undefined) fields.message = text
    }

    logger[level]('http.request', fields)
  }

  return {
    onRequest(ctx: BaseContext): void {
      if (pending.has(ctx.request)) return
      const url = new URL(ctx.request.url)
      const inbound = ctx.request.headers.get('x-request-id')
      const id = inbound && REQUEST_ID.test(inbound) ? inbound : generateId()
      ctx.set.headers['x-request-id'] = id
      pending.set(ctx.request, {
        id,
        method: ctx.request.method,
        path: url.pathname,
        startedAt: clock(),
        ip: ipOf(ctx.request),
        ua: ctx.request.headers.get('user-agent') ?? undefined,
      })
    },

    onAfterHandle(
      ctx: BaseContext & {
        user?: { id?: string }
        me?: { role?: string; status?: string | null }
      },
    ): void {
      const record = pending.get(ctx.request)
      if (!record) return
      if (ctx.user?.id) record.userId = ctx.user.id
      if (ctx.me?.role) record.role = ctx.me.role
      if (ctx.me?.status) record.membership = ctx.me.status
    },

    onError(
      ctx: BaseContext & { code?: string | number; error?: unknown; message?: string },
    ): void {
      const record = pending.get(ctx.request)
      if (!record) return
      if (ctx.code !== undefined) record.errorCode = String(ctx.code)
      record.error = ctx.error
      if (ctx.message !== undefined) record.message = ctx.message
    },

    onAfterResponse(ctx: BaseContext & { response?: unknown }): void {
      const record = pending.get(ctx.request)
      if (!record) return
      const status = statusOf(ctx.response, ctx.set)
      const message = status >= 400 ? messageFromResponse(ctx.response) : undefined
      emit(ctx.request, record, status, message)
    },

    /**
     * better-auth is answered by a `return` inside `onRequest`, where `onAfterResponse` never runs.
     * The app wraps that one path and calls this so logins are not invisible.
     */
    logShortCircuit(request: Request, response: Response): void {
      const record = pending.get(request)
      if (!record) return
      emit(request, record, response.status, undefined)
    },

    /** A child logger carrying `requestId` (and `userId` once known); base logger otherwise. */
    requestLogger(request: Request): Logger {
      const record = pending.get(request)
      if (!record) return logger
      const bound: Fields = { requestId: record.id }
      if (record.userId !== undefined) bound.userId = record.userId
      return logger.child(bound)
    },
  }
}

export type RequestLog = ReturnType<typeof createRequestLog>
