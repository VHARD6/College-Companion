/**
 * Pure mathematical functions for image fitting, zoom scaling, and pan bounds clamping.
 * Used by the FullscreenImageViewer component and fully unit-testable without a browser DOM.
 */

export interface Dimensions {
  width: number
  height: number
}

export interface PanBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface Point {
  x: number
  y: number
}

/**
 * Calculates the fitted width and height of an image within a container
 * while strictly preserving aspect ratio so the full image is visible.
 */
export function calculateFitDimensions(
  container: Dimensions,
  natural: Dimensions
): Dimensions {
  if (
    !container ||
    !natural ||
    !Number.isFinite(container.width) ||
    !Number.isFinite(container.height) ||
    !Number.isFinite(natural.width) ||
    !Number.isFinite(natural.height) ||
    container.width <= 0 ||
    container.height <= 0 ||
    natural.width <= 0 ||
    natural.height <= 0
  ) {
    return { width: 0, height: 0 }
  }

  const widthRatio = container.width / natural.width
  const heightRatio = container.height / natural.height
  const fitScale = Math.min(widthRatio, heightRatio)

  return {
    width: Math.round(natural.width * fitScale),
    height: Math.round(natural.height * fitScale),
  }
}

/**
 * Calculates pan boundaries for a given zoom level.
 * - When zoom <= 1.0 (or image is smaller than container), bounds are 0, preventing drifting.
 * - When zoom > 1.0 and image overflows container, bounds allow panning from edge to edge
 *   while preventing the image from being lost off-screen.
 */
export function calculatePanBounds(
  container: Dimensions,
  fitted: Dimensions,
  zoom: number
): PanBounds {
  if (
    !container ||
    !fitted ||
    !Number.isFinite(zoom) ||
    zoom <= 1.001 ||
    !Number.isFinite(container.width) ||
    !Number.isFinite(container.height) ||
    !Number.isFinite(fitted.width) ||
    !Number.isFinite(fitted.height)
  ) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  }

  const currentWidth = fitted.width * zoom
  const currentHeight = fitted.height * zoom

  const maxTranslateX = Math.max(0, (currentWidth - container.width) / 2)
  const maxTranslateY = Math.max(0, (currentHeight - container.height) / 2)

  return {
    minX: -maxTranslateX || 0,
    maxX: maxTranslateX,
    minY: -maxTranslateY || 0,
    maxY: maxTranslateY,
  }
}

/**
 * Clamps a numeric value between minimum and maximum bounds.
 */
export function clamp(val: number, min: number, max: number): number {
  if (isNaN(val) || isNaN(min)) return isNaN(min) ? 0 : min
  if (isNaN(max)) return val
  if (min > max) return min
  return Math.max(min, Math.min(val, max))
}

/**
 * Calculates Euclidean distance between two 2D points.
 */
export function calculateDistance(p1: Point, p2: Point): number {
  if (
    !p1 ||
    !p2 ||
    !Number.isFinite(p1.x) ||
    !Number.isFinite(p1.y) ||
    !Number.isFinite(p2.x) ||
    !Number.isFinite(p2.y)
  ) {
    return 0
  }
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

/**
 * Calculates midpoint between two 2D points.
 */
export function calculateMidpoint(p1: Point, p2: Point): Point {
  if (!p1 || !p2) return { x: 0, y: 0 }
  const x1 = Number.isFinite(p1.x) ? p1.x : 0
  const y1 = Number.isFinite(p1.y) ? p1.y : 0
  const x2 = Number.isFinite(p2.x) ? p2.x : 0
  const y2 = Number.isFinite(p2.y) ? p2.y : 0
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  }
}
