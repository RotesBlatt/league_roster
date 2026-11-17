import { createTheme, type MantineColorsTuple } from '@mantine/core'

/** LoL-ish teal/green accent. Swap the ramp to restyle the whole app. */
const brand: MantineColorsTuple = [
  '#e6fcf5',
  '#c3fae8',
  '#96f2d7',
  '#63e6be',
  '#38d9a9',
  '#20c997',
  '#12b886',
  '#0ca678',
  '#099268',
  '#087f5b',
]

export const theme = createTheme({
  primaryColor: 'brand',
  defaultRadius: 'md',
  cursorType: 'pointer',
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  headings: { fontWeight: '700' },
  colors: { brand },
  components: {
    Table: {
      defaultProps: { verticalSpacing: 'xs', highlightOnHover: true },
    },
    Card: {
      defaultProps: { withBorder: true },
    },
  },
})
