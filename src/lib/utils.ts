/** Format a weekday number (0=Mon) to a short name */
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAY_FULL  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Format a DATE string (YYYY-MM-DD) to a readable label */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  })
}

/** Format a TIME string (HH:MM:SS) to 12-hour */
export function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Get today's weekday index (0=Mon) */
export function todayWeekday(): number {
  const day = new Date().getDay()  // 0=Sun in JS
  return day === 0 ? 6 : day - 1   // convert to 0=Mon
}

/** Today's date as YYYY-MM-DD string */
export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

/** Clamp a number between min and max */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}
