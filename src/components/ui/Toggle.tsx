interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

/**
 * Large P/A toggle switch.
 * Green = Present, Red = Absent — plus text labels (accessible without color).
 */
export default function Toggle({ checked, onChange, label, disabled = false }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        relative inline-flex h-8 w-20 items-center rounded-full text-xs font-bold
        transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
        disabled:opacity-40 disabled:cursor-not-allowed
        ${checked
          ? 'bg-green-500 focus:ring-green-500'
          : 'bg-red-500   focus:ring-red-500'}
      `}
    >
      {/* Sliding pill */}
      <span
        className={`
          absolute h-6 w-8 rounded-full bg-white shadow transition-transform
          ${checked ? 'translate-x-11' : 'translate-x-1'}
        `}
      />
      {/* Text labels — always visible, not just color */}
      <span className={`absolute text-white ${checked ? 'left-2' : 'right-2'}`}>
        {checked ? 'P' : 'A'}
      </span>
    </button>
  )
}
