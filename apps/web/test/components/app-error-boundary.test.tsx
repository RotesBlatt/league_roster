import { afterEach, describe, expect, test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { AppErrorBoundary } from '../../src/components/AppErrorBoundary.tsx'

/**
 * The one guarantee: a render exception must never leave a blank page. React 19 unmounts the
 * whole tree on an uncaught error, which is exactly the "nothing at all" symptom.
 */
function Exploding(): never {
  throw new Error('kaboom while rendering')
}

describe('AppErrorBoundary', () => {
  const logged = console.error
  afterEach(() => {
    console.error = logged
  })

  test('shows the error message instead of unmounting to a white page', () => {
    // React logs the caught error itself; keep the test output readable
    console.error = () => {}

    render(
      <MantineProvider>
        <AppErrorBoundary>
          <Exploding />
        </AppErrorBoundary>
      </MantineProvider>,
    )

    expect(screen.getByText('Something broke while rendering')).toBeDefined()
    // it appears twice on purpose: once as the message, once inside the stack
    expect(screen.getAllByText(/kaboom while rendering/).length).toBeGreaterThan(0)
  })

  test('renders children when nothing throws', () => {
    render(
      <MantineProvider>
        <AppErrorBoundary>
          <div>all good</div>
        </AppErrorBoundary>
      </MantineProvider>,
    )

    expect(screen.getByText('all good')).toBeDefined()
  })
})
