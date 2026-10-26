import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateFitDimensions,
  calculatePanBounds,
  clamp,
  calculateDistance,
  calculateMidpoint,
  type Dimensions,
  type Point,
} from '../src/lib/timetableGesture.ts'

describe('Timetable Gesture & Math Utilities Suite', () => {
  describe('calculateFitDimensions', () => {
    it('returns 0x0 for non-positive or empty container dimensions', () => {
      assert.deepEqual(
        calculateFitDimensions({ width: 0, height: 600 }, { width: 1200, height: 800 }),
        { width: 0, height: 0 }
      )
      assert.deepEqual(
        calculateFitDimensions({ width: 800, height: -10 }, { width: 1200, height: 800 }),
        { width: 0, height: 0 }
      )
    })

    it('returns 0x0 for non-positive or empty natural image dimensions', () => {
      assert.deepEqual(
        calculateFitDimensions({ width: 800, height: 600 }, { width: 0, height: 800 }),
        { width: 0, height: 0 }
      )
      assert.deepEqual(
        calculateFitDimensions({ width: 800, height: 600 }, { width: 1200, height: 0 }),
        { width: 0, height: 0 }
      )
    })

    it('fits width-constrained landscape image inside portrait container', () => {
      // Container: 400x800 (ratio 0.5), Natural: 1200x600 (ratio 2.0)
      // Width scale: 400/1200 = 1/3, Height scale: 800/600 = 1.333
      // fitScale = 1/3 -> width: 400, height: 200
      const container: Dimensions = { width: 400, height: 800 }
      const natural: Dimensions = { width: 1200, height: 600 }
      const fitted = calculateFitDimensions(container, natural)

      assert.equal(fitted.width, 400)
      assert.equal(fitted.height, 200)
      assert.ok(fitted.width <= container.width)
      assert.ok(fitted.height <= container.height)
    })

    it('fits height-constrained image inside landscape container', () => {
      // Container: 1000x500 (ratio 2.0), Natural: 800x800 (ratio 1.0)
      // Width scale: 1000/800 = 1.25, Height scale: 500/800 = 0.625
      // fitScale = 0.625 -> width: 500, height: 500
      const container: Dimensions = { width: 1000, height: 500 }
      const natural: Dimensions = { width: 800, height: 800 }
      const fitted = calculateFitDimensions(container, natural)

      assert.equal(fitted.width, 500)
      assert.equal(fitted.height, 500)
      assert.ok(fitted.width <= container.width)
      assert.ok(fitted.height <= container.height)
    })

    it('maintains exact aspect ratio when image matches container aspect ratio', () => {
      const container: Dimensions = { width: 1920, height: 1080 }
      const natural: Dimensions = { width: 3840, height: 2160 }
      const fitted = calculateFitDimensions(container, natural)

      assert.equal(fitted.width, 1920)
      assert.equal(fitted.height, 1080)
    })
  })

  describe('calculatePanBounds', () => {
    it('returns zero bounds when zoom is 1.0 or less to prevent image drifting', () => {
      const container: Dimensions = { width: 400, height: 800 }
      const fitted: Dimensions = { width: 400, height: 250 }
      const bounds = calculatePanBounds(container, fitted, 1.0)

      assert.deepEqual(bounds, { minX: 0, maxX: 0, minY: 0, maxY: 0 })
    })

    it('returns zero bounds for micro-zoom near 1.001', () => {
      const container: Dimensions = { width: 400, height: 800 }
      const fitted: Dimensions = { width: 400, height: 250 }
      const bounds = calculatePanBounds(container, fitted, 1.0005)

      assert.deepEqual(bounds, { minX: 0, maxX: 0, minY: 0, maxY: 0 })
    })

    it('calculates symmetrical bounds when zoomed in and dimensions exceed container', () => {
      // Container: 400x800, Fitted: 400x250, Zoom: 2.0
      // Scaled: 800 width, 500 height
      // maxTranslateX = (800 - 400) / 2 = 200
      // maxTranslateY = Math.max(0, (500 - 800) / 2) = 0
      const container: Dimensions = { width: 400, height: 800 }
      const fitted: Dimensions = { width: 400, height: 250 }
      const bounds = calculatePanBounds(container, fitted, 2.0)

      assert.equal(bounds.minX, -200)
      assert.equal(bounds.maxX, 200)
      assert.equal(bounds.minY, 0)
      assert.equal(bounds.maxY, 0)
    })

    it('calculates 2D bounds when both dimensions overflow container at high zoom', () => {
      // Container: 400x800, Fitted: 400x250, Zoom: 4.0
      // Scaled: 1600 width, 1000 height
      // maxTranslateX = (1600 - 400) / 2 = 600
      // maxTranslateY = (1000 - 800) / 2 = 100
      const container: Dimensions = { width: 400, height: 800 }
      const fitted: Dimensions = { width: 400, height: 250 }
      const bounds = calculatePanBounds(container, fitted, 4.0)

      assert.equal(bounds.minX, -600)
      assert.equal(bounds.maxX, 600)
      assert.equal(bounds.minY, -100)
      assert.equal(bounds.maxY, 100)
    })
  })

  describe('clamp', () => {
    it('clamps value within range', () => {
      assert.equal(clamp(5, 1, 10), 5)
    })

    it('clamps to min when value is below min', () => {
      assert.equal(clamp(-5, 0, 10), 0)
    })

    it('clamps to max when value is above max', () => {
      assert.equal(clamp(15, 0, 10), 10)
    })

    it('returns min if value is NaN', () => {
      assert.equal(clamp(NaN, 2, 8), 2)
    })

    it('returns min if min is greater than max', () => {
      assert.equal(clamp(5, 10, 2), 10)
    })
  })

  describe('calculateDistance', () => {
    it('calculates 3-4-5 Pythagorean triangle distance', () => {
      const p1: Point = { x: 0, y: 0 }
      const p2: Point = { x: 3, y: 4 }
      assert.equal(calculateDistance(p1, p2), 5)
    })

    it('returns 0 for identical points', () => {
      const p1: Point = { x: 120, y: 340 }
      const p2: Point = { x: 120, y: 340 }
      assert.equal(calculateDistance(p1, p2), 0)
    })

    it('handles negative coordinates correctly', () => {
      const p1: Point = { x: -5, y: -5 }
      const p2: Point = { x: -2, y: -1 }
      // dx = 3, dy = 4 -> 5
      assert.equal(calculateDistance(p1, p2), 5)
    })
  })

  describe('calculateMidpoint', () => {
    it('finds the exact midpoint between two points', () => {
      const p1: Point = { x: 10, y: 20 }
      const p2: Point = { x: 30, y: 60 }
      assert.deepEqual(calculateMidpoint(p1, p2), { x: 20, y: 40 })
    })

    it('finds the midpoint spanning negative and positive coordinates', () => {
      const p1: Point = { x: -50, y: -20 }
      const p2: Point = { x: 50, y: 20 }
      assert.deepEqual(calculateMidpoint(p1, p2), { x: 0, y: 0 })
    })
  })
})
