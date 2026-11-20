import { join } from 'node:path'
import type { Writable } from 'node:stream'
import pretty from 'pino-pretty'
import roll from 'pino-roll'
import type { Destination } from './logger.ts'

export type FileLogConfig = { toFile: boolean; dir: string; retentionDays: number }

export type Destinations = Destination & { close(): Promise<void> }

export type DestinationOptions = {
  /** defaults to stdout; tests pass a capture */
  console?: Writable
  /** defaults to `process.stdout.isTTY` */
  colorize?: boolean
}

/**
 * One line in, two sinks out: raw NDJSON to a daily rotating file (pino-roll) and a pretty,
 * human-readable line to the console (pino-pretty). Either sink failing must not affect the other.
 */
export async function createDestinations(
  log: FileLogConfig,
  options: DestinationOptions = {},
): Promise<Destinations> {
  const consoleSink = options.console ?? process.stdout
  const colorize = options.colorize ?? (!options.console && Boolean(process.stdout.isTTY))
  const prettyStream = pretty({ destination: consoleSink, colorize })

  const file = log.toFile
    ? await roll({
        file: join(log.dir, 'api'),
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        mkdir: true,
        sync: true,
        limit: { count: log.retentionDays },
      })
    : undefined

  return {
    write(line) {
      try {
        file?.write(line)
      } catch {
        // a full or unwritable disk must not take the console down with it
      }
      try {
        prettyStream.write(line)
      } catch {
        // ...and a broken console must not lose the file line
      }
    },
    async close() {
      try {
        file?.end()
      } catch {
        // already closed
      }
    },
  }
}
