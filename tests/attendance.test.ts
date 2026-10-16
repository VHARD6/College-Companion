import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcPercent,
  calcSkippable,
  calcNeeded,
  calcWhatIf,
  classifyStatus,
} from '../src/lib/attendance.ts'

describe('Attendance Formulas & Edge Cases Test Suite', () => {
  describe('calcPercent', () => {
    it('returns null when zero classes have been held', () => {
      assert.equal(calcPercent(0, 0), null)
    })

    it('calculates 100% when all classes are attended', () => {
      assert.equal(calcPercent(10, 10), 100)
    })

    it('calculates 0% when zero classes attended out of held', () => {
      assert.equal(calcPercent(0, 5), 0)
    })

    it('rounds to 1 decimal place', () => {
      // 2 / 3 = 66.666... -> 66.7
      assert.equal(calcPercent(2, 3), 66.7)
      // 1 / 3 = 33.333... -> 33.3
      assert.equal(calcPercent(1, 3), 33.3)
      // 3 / 4 = 75.0
      assert.equal(calcPercent(3, 4), 75)
    })
  })

  describe('calcSkippable', () => {
    it('returns 0 when 0 classes have been held', () => {
      assert.equal(calcSkippable(0, 0, 75), 0)
    })

    it('returns 0 when threshold is 0 or negative', () => {
      assert.equal(calcSkippable(5, 5, 0), 0)
    })

    it('correctly calculates skippable classes for high attendance', () => {
      // 9 out of 10 attended (90%). At 75%:
      // floor(900 / 75 - 10) = floor(12 - 10) = 2.
      // If student skips 2: 9 / 12 = 75%. Still safe.
      assert.equal(calcSkippable(9, 10, 75), 2)
    })

    it('clamps to 0 when currently below threshold', () => {
      // 6 out of 10 attended (60%). Cannot skip any classes.
      assert.equal(calcSkippable(6, 10, 75), 0)
    })

    it('returns 0 when exactly at threshold', () => {
      // 3 out of 4 attended (75%).
      // floor(300 / 75 - 4) = floor(4 - 4) = 0.
      assert.equal(calcSkippable(3, 4, 75), 0)
    })
  })

  describe('calcNeeded', () => {
    it('returns 0 when 0 classes have been held', () => {
      assert.equal(calcNeeded(0, 0, 75), 0)
    })

    it('returns 0 when current percentage is already at or above threshold', () => {
      assert.equal(calcNeeded(9, 10, 75), 0)
      assert.equal(calcNeeded(3, 4, 75), 0)
    })

    it('calculates exact consecutive classes needed to recover', () => {
      // 6 out of 10 attended (60%), threshold 75%
      // ceil((75 * 10 - 100 * 6) / 25) = ceil(150 / 25) = 6.
      // Attending 6 more: (6 + 6) / (10 + 6) = 12 / 16 = 75%.
      assert.equal(calcNeeded(6, 10, 75), 6)
    })

    it('handles student with 0 attended out of 2 held', () => {
      // 0 / 2. threshold 75%
      // ceil((150 - 0) / 25) = 6.
      // Attending 6 more: 6 / 8 = 75%.
      assert.equal(calcNeeded(0, 2, 75), 6)
    })

    it('returns Infinity when threshold is 100% and a class was missed', () => {
      assert.equal(calcNeeded(4, 5, 100), Infinity)
    })
  })

  describe('calcWhatIf', () => {
    it('projects percentage after attending more classes', () => {
      // 6 attended out of 10 held. If 2 more held and 2 attended: 8 / 12 = 66.7%
      assert.equal(calcWhatIf(6, 10, 2, 2), 66.7)
    })

    it('projects percentage after missing more classes', () => {
      // 6 attended out of 10 held. If 2 more held and 0 attended: 6 / 12 = 50.0%
      assert.equal(calcWhatIf(6, 10, 2, 0), 50)
    })
  })

  describe('classifyStatus', () => {
    it('returns unknown when percent is null', () => {
      assert.equal(classifyStatus(null, 75), 'unknown')
    })

    it('returns safe when percent is at or above threshold', () => {
      assert.equal(classifyStatus(75, 75), 'safe')
      assert.equal(classifyStatus(85.5, 75), 'safe')
    })

    it('returns warning when percent is within 10% below threshold', () => {
      assert.equal(classifyStatus(74.9, 75), 'warning')
      assert.equal(classifyStatus(65, 75), 'warning')
    })

    it('returns danger when percent is more than 10% below threshold', () => {
      assert.equal(classifyStatus(64.9, 75), 'danger')
      assert.equal(classifyStatus(30, 75), 'danger')
      assert.equal(classifyStatus(0, 75), 'danger')
    })
  })
})
