import { type InputHTMLAttributes, forwardRef, type ReactNode } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  labelClassName?: string
  error?: string
  rightElement?: ReactNode
}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, labelClassName = 'text-gray-700', error, rightElement, className = '', ...rest }, ref) => (
    <div className="w-full">
      {label && <label className={`block text-sm font-medium mb-1 ${labelClassName}`}>{label}</label>}
      <div className="relative">
        <input
          ref={ref}
          className={`block w-full rounded-xl border ${
            error ? 'border-red-400' : 'border-gray-300'
          } px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            rightElement ? 'pr-11' : ''
          } ${className}`}
          {...rest}
        />
        {rightElement && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-auto">
            {rightElement}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
)

Input.displayName = 'Input'
export default Input
