import { ChevronLeft, ChevronRight } from 'lucide-react'
import { calcPaginationSummary } from '../../lib/pagination'

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  totalCount: number
  pageSize: number
  onPageChange: (newPage: number) => void
  isLoading?: boolean
}

export default function PaginationControls({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  isLoading = false,
}: PaginationControlsProps) {
  if (totalCount === 0) return null

  const summary = calcPaginationSummary(currentPage, pageSize, totalCount)
  const isFirstPage = currentPage <= 1
  const isLastPage = currentPage >= totalPages

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-gray-200 text-xs text-gray-600">
      <span className="font-medium text-gray-500">{summary}</span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={isFirstPage || isLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-gray-700"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
          <span>Previous</span>
        </button>

        <span className="px-2 py-1 font-semibold text-gray-700 bg-gray-100 rounded-lg">
          {currentPage} / {Math.max(1, totalPages)}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={isLastPage || isLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-gray-700"
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
