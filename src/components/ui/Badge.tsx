type Variant = 'green' | 'red' | 'yellow' | 'blue' | 'gray'

interface Props {
  variant: Variant
  children: React.ReactNode
}

const styles: Record<Variant, string> = {
  green:  'bg-green-100 text-green-800',
  red:    'bg-red-100   text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  blue:   'bg-blue-100  text-blue-800',
  gray:   'bg-gray-100  text-gray-600',
}

export default function Badge({ variant, children }: Props) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  )
}
