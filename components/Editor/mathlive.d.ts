import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        value?: string
        'read-only'?: boolean
      }, HTMLElement>
      'math-span': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'math-div': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
