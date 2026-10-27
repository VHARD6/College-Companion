/**
 * Core attendance formulas.
 * These are pure functions — no side effects, easy to test.
 */

/**
 * Calculate current attendance percentage.
 * Returns null if no classes have been held yet, or on invalid non-finite/negative inputs.
 */
export function calcPercent(attended: number, held: number): number | null {
  if (!Number.isFinite(attended) || !Number.isFinite(held) || held <= 0 || attended < 0) {
    return null
  }
  return Math.round((attended / held) * 100 * 10) / 10  // 1 decimal place
}

/**
 * How many more classes can the student skip and still stay at or above threshold?
 * Formula: floor(attended * 100 / threshold - held)
 * Clamps at 0 (can't be negative).
 */
export function calcSkippable(attended: number, held: number, threshold: number): number {
  if (!Number.isFinite(attended) || !Number.isFinite(held) || !Number.isFinite(threshold)) return 0
  if (held <= 0 || threshold <= 0 || attended < 0) return 0
  const raw = Math.floor((attended * 100) / threshold - held)
  return Math.max(0, raw)
}

/**
 * How many consecutive classes must the student attend to reach the threshold?
 * Only meaningful when currently below threshold.
 * Formula: ceil((threshold * held - 100 * attended) / (100 - threshold))
 */
export function calcNeeded(attended: number, held: number, threshold: number): number {
  if (!Number.isFinite(attended) || !Number.isFinite(held) || !Number.isFinite(threshold)) return 0
  if (threshold >= 100) return Infinity  // impossible or edge case
  if (threshold <= 0 || held <= 0 || attended < 0) return 0
  const raw = Math.ceil((threshold * held - 100 * attended) / (100 - threshold))
  return Math.max(0, raw)
}

/**
 * What-if: project percentage after attending or missing `n` more classes.
 */
export function calcWhatIf(
  attended: number,
  held: number,
  additionalHeld: number,
  additionalAttended: number
): number | null {
  if (
    !Number.isFinite(attended) ||
    !Number.isFinite(held) ||
    !Number.isFinite(additionalHeld) ||
    !Number.isFinite(additionalAttended) ||
    additionalHeld < 0 ||
    additionalAttended < 0
  ) {
    return null
  }
  const newHeld = held + additionalHeld
  const newAttended = attended + additionalAttended
  return calcPercent(newAttended, newHeld)
}

/**
 * Classify a percentage relative to the threshold for color coding.
 */
export function classifyStatus(
  percent: number | null,
  threshold: number
): 'safe' | 'warning' | 'danger' | 'unknown' {
  if (percent === null || !Number.isFinite(percent) || !Number.isFinite(threshold)) return 'unknown'
  if (percent >= threshold) return 'safe'
  if (percent >= threshold - 10) return 'warning'  // within 10% of threshold
  return 'danger'
}
