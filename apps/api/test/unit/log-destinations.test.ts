import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { createDestinations } from '../../src/lib/log/destinations.ts'

const LOG_FILE = /^api\.\d{4}-\d{2}-\d{2}\.\d+\.log$/

function captureConsole() {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  return { stream, text: () => chunks.join('') }
}

function logFiles(dir: string) {
  return existsSync(dir) ? readdirSync(dir).filter((name) => LOG_FILE.test(name)) : []
}

function firstLogFile(dir: string): string {
  const [file] = logFiles(dir)
  if (!file) throw new Error(`no log file in ${dir}`)
  return file
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for file')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const line = (event: string) => `${JSON.stringify({ level: 'info', event, inviteId: 'inv_1' })}\n`

describe('createDestinations', () => {
  test('console only: no file is written and the console gets a pretty line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-logs-'))
    const output = captureConsole()
    const dest = await createDestinations(
      { toFile: false, dir, retentionDays: 14 },
      { console: output.stream },
    )

    dest.write(line('invite.claimed'))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(logFiles(dir)).toEqual([])
    expect(output.text()).toContain('invite.claimed')
    expect(output.text()).toContain('INFO')
    expect(output.text()).not.toContain('"level"')

    await dest.close()
  })

  test('file: appends the raw NDJSON line to a daily api log file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-logs-'))
    const dest = await createDestinations(
      { toFile: true, dir, retentionDays: 14 },
      { console: captureConsole().stream },
    )

    dest.write(line('invite.claimed'))
    await waitFor(() => logFiles(dir).length > 0)

    expect(readFileSync(join(dir, firstLogFile(dir)), 'utf8')).toContain('"event":"invite.claimed"')

    await dest.close()
  })

  test('fans one line out to both the file and the console', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-logs-'))
    const output = captureConsole()
    const dest = await createDestinations(
      { toFile: true, dir, retentionDays: 14 },
      { console: output.stream },
    )

    dest.write(line('invite.claimed'))
    await waitFor(() => logFiles(dir).length > 0 && output.text().length > 0)

    expect(output.text()).toContain('invite.claimed')
    expect(readFileSync(join(dir, firstLogFile(dir)), 'utf8')).toContain('"event":"invite.claimed"')

    await dest.close()
  })
})
