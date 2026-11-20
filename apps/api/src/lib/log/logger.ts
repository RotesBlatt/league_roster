import pino from 'pino'

/**
 * The logger the API talks to. Deliberately narrow and pino-free so route code never imports a
 * library and tests can inject a capture stream. `createLogger` is the only place pino is built.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error'

export type Fields = Record<string, unknown>

/** A sink: one NDJSON line in, no promise back. Must not be assumed to succeed. */
export type Destination = { write(line: string): void }

export type Logger = {
  debug(event: string, fields?: Fields): void
  info(event: string, fields?: Fields): void
  warn(event: string, fields?: Fields): void
  error(event: string, fields?: Fields): void
  /** bound fields, same destinations */
  child(fields: Fields): Logger
}

export type LoggerOptions = {
  level?: Level
  /** defaults to stdout; tests pass a capture */
  destination?: Destination
  /** injection point for `ts`, so a test can pin the timestamp */
  clock?: () => Date
}

/** Keys whose value is a credential. Pino redacts them before they reach any destination. */
const REDACT_PATHS = [
  'cookie',
  'authorization',
  'set-cookie',
  'token',
  'password',
  'secret',
  '*.cookie',
  '*.authorization',
  '*.token',
  '*.password',
  '*.secret',
]

function fromPino(instance: pino.Logger, level: Level) {
  return (event: string, fields: Fields = {}) => {
    try {
      instance[level]({ event, ...fields })
    } catch {
      // A broken destination must never break the caller; the request still gets its response.
    }
  }
}

function wrap(instance: pino.Logger): Logger {
  return {
    debug: fromPino(instance, 'debug'),
    info: fromPino(instance, 'info'),
    warn: fromPino(instance, 'warn'),
    error: fromPino(instance, 'error'),
    child: (fields) => wrap(instance.child(fields)),
  }
}

/**
 * Build the real logger. The record keeps the documented shape: `ts` (ISO), string `level`,
 * `event`, then fields — no `pid`/`hostname`, which only add noise to a single-process API.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const clock = options.clock ?? (() => new Date())
  const instance = pino(
    {
      level: options.level ?? 'info',
      base: null,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      timestamp: () => `,"ts":${JSON.stringify(clock().toISOString())}`,
      formatters: { level: (label) => ({ level: label }) },
      serializers: {
        // pino does not turn an `error` field into message+stack on its own.
        error: (value: unknown) =>
          value instanceof Error ? pino.stdSerializers.err(value) : value,
        err: pino.stdSerializers.err,
      },
    },
    options.destination,
  )
  return wrap(instance)
}
