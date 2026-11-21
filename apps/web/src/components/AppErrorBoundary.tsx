import { Button, Card, Center, Code, Stack, Text, Title } from '@mantine/core'
import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Without this, any exception during render unmounts the whole tree and the browser shows a blank
 * page — the app shell included, so not even the URL helps you guess what broke. React 19 gives no
 * default fallback, and this is the only reason a white screen should be impossible.
 *
 * Deliberately plain: the message, the stack, and a reload. It is a diagnostic, not a design.
 */
type Props = { children: ReactNode }
type State = { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // one line, so the browser console has it even if the UI is dismissed
    console.error('[app] render failed', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <Center h="100vh" p="md">
        <Card maw={760} w="100%">
          <Stack>
            <Title order={3}>Something broke while rendering</Title>
            <Text size="sm" c="dimmed">
              {error.name}: {error.message}
            </Text>
            {error.stack ? (
              <Code block maw="100%" style={{ maxHeight: 320, overflow: 'auto' }}>
                {error.stack}
              </Code>
            ) : null}
            <Button onClick={() => location.reload()}>Reload</Button>
          </Stack>
        </Card>
      </Center>
    )
  }
}
