export default function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-spin rounded-full border-4 border-gray-200 border-t-blue-600 ${className}`} />
  )
}
