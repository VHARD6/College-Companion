/**
 * Pagination helper utilities for server-side range queries and pagination controls.
 * Pure functions with zero side-effects.
 */

export interface PageRange {
  from: number
  to: number
}

/**
 * Calculates zero-indexed database range parameters [from, to] for Supabase .range(from, to).
 */
export function calcPageRange(page: number, pageSize: number): PageRange {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 10

  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  return { from, to }
}

/**
 * Computes total number of pages based on total records and page size.
 * Always returns at least 1 page.
 */
export function calcTotalPages(totalCount: number, pageSize: number): number {
  if (!Number.isFinite(totalCount) || totalCount <= 0) return 1
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 10
  return Math.max(1, Math.ceil(totalCount / safePageSize))
}

/**
 * Formats a user-friendly pagination summary string (e.g. "Showing 1–25 of 120").
 */
export function calcPaginationSummary(page: number, pageSize: number, totalCount: number): string {
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return 'Showing 0 of 0'
  }

  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 10

  const from = (safePage - 1) * safePageSize + 1
  const to = Math.min(safePage * safePageSize, totalCount)

  if (from > totalCount) {
    return `Showing ${totalCount} of ${totalCount}`
  }

  return `Showing ${from}–${to} of ${totalCount}`
}

/**
 * Clamps target page number to ensure it stays within [1, totalPages].
 */
export function clampPage(page: number, totalPages: number): number {
  const safeTotal = Number.isFinite(totalPages) && totalPages >= 1 ? Math.floor(totalPages) : 1
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(Math.floor(page), safeTotal)
}
