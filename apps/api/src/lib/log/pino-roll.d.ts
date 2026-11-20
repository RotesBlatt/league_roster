declare module 'pino-roll' {
  interface RollOptions {
    /** base path; the date and a rotation count are appended */
    file: string
    frequency?: 'daily' | 'hourly' | number
    dateFormat?: string
    mkdir?: boolean
    sync?: boolean
    size?: number | string
    extension?: string
    limit?: { count?: number; removeOtherLogFiles?: boolean }
  }

  interface RollStream {
    write(line: string): boolean
    end(callback?: () => void): void
  }

  /** pino-roll's default export is an async factory for its rotating stream. */
  export default function roll(options: RollOptions): Promise<RollStream>
}
