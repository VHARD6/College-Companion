import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcPageRange,
  calcTotalPages,
  calcPaginationSummary,
  clampPage,
} from '../src/lib/pagination.ts'

describe('Pagination Utilities Test Suite', () => {
  describe('calcPageRange (Server-side range query indices)', () => {
    it('calculates exact range for page 1 with page size 25', () => {
      const range = calcPageRange(1, 25)
      assert.deepEqual(range, { from: 0, to: 24 })
    })

    it('calculates exact range for page 2 with page size 25', () => {
      const range = calcPageRange(2, 25)
      assert.deepEqual(range, { from: 25, to: 49 })
    })

    it('calculates exact range for page 5 with page size 50', () => {
      const range = calcPageRange(5, 50)
      assert.deepEqual(range, { from: 200, to: 249 })
    })

    it('handles negative, zero, or non-finite page numbers by defaulting to page 1', () => {
      assert.deepEqual(calcPageRange(0, 20), { from: 0, to: 19 })
      assert.deepEqual(calcPageRange(-5, 20), { from: 0, to: 19 })
      assert.deepEqual(calcPageRange(NaN, 20), { from: 0, to: 19 })
      assert.deepEqual(calcPageRange(Infinity, 20), { from: 0, to: 19 })
    })

    it('handles negative, zero, or non-finite page sizes by defaulting to size 10', () => {
      assert.deepEqual(calcPageRange(1, 0), { from: 0, to: 9 })
      assert.deepEqual(calcPageRange(1, -10), { from: 0, to: 9 })
      assert.deepEqual(calcPageRange(1, NaN), { from: 0, to: 9 })
    })
  })

  describe('calcTotalPages', () => {
    it('returns 1 when totalCount is 0 or negative', () => {
      assert.equal(calcTotalPages(0, 25), 1)
      assert.equal(calcTotalPages(-10, 25), 1)
      assert.equal(calcTotalPages(NaN, 25), 1)
    })

    it('returns exact page count when totalCount is divisible by pageSize', () => {
      assert.equal(calcTotalPages(50, 25), 2)
      assert.equal(calcTotalPages(100, 20), 5)
    })

    it('rounds up to include remaining records on the final page', () => {
      assert.equal(calcTotalPages(51, 25), 3)
      assert.equal(calcTotalPages(1, 25), 1)
      assert.equal(calcTotalPages(26, 25), 2)
    })
  })

  describe('calcPaginationSummary', () => {
    it('returns "Showing 0 of 0" when there are no records', () => {
      assert.equal(calcPaginationSummary(1, 25, 0), 'Showing 0 of 0')
      assert.equal(calcPaginationSummary(1, 25, -1), 'Showing 0 of 0')
    })

    it('formats summary for first page with partial fill', () => {
      assert.equal(calcPaginationSummary(1, 25, 12), 'Showing 1–12 of 12')
    })

    it('formats summary for first page with full page', () => {
      assert.equal(calcPaginationSummary(1, 25, 100), 'Showing 1–25 of 100')
    })

    it('formats summary for middle page', () => {
      assert.equal(calcPaginationSummary(2, 25, 100), 'Showing 26–50 of 100')
    })

    it('formats summary for final partial page', () => {
      assert.equal(calcPaginationSummary(4, 25, 83), 'Showing 76–83 of 83')
    })
  })

  describe('clampPage', () => {
    it('returns 1 if requested page is less than 1', () => {
      assert.equal(clampPage(0, 5), 1)
      assert.equal(clampPage(-2, 5), 1)
      assert.equal(clampPage(NaN, 5), 1)
    })

    it('returns totalPages if requested page exceeds totalPages', () => {
      assert.equal(clampPage(10, 5), 5)
      assert.equal(clampPage(999, 1), 1)
    })

    it('returns valid page untouched if within range', () => {
      assert.equal(clampPage(3, 5), 3)
      assert.equal(clampPage(1, 1), 1)
    })
  })
})
