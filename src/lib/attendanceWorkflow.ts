import type { AttendanceStatus, SessionType } from '../types'

/**
 * Natural / alphanumeric sort for student roll numbers.
 * Handles:
 * - purely numeric: '1', '2', '10' -> '1', '2', '10'
 * - prefixed: 'CS01', 'CS02', 'CS10' -> 'CS01', 'CS02', 'CS10'
 * - mixed alphanumeric without crashing or corrupting order
 */
export function sortStudentsByRollNo<T extends { roll_no: string }>(students: T[]): T[] {
  return [...students].sort((a, b) =>
    a.roll_no.localeCompare(b.roll_no, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/**
 * Initialize roster status map.
 * Rule:
 * 1. If existingRecords are provided (e.g. from a draft or submitted session),
 *    restore them exactly.
 * 2. If no existing records exist (new session), EVERY eligible student defaults to 'present'.
 */
export function initRosterStatus(
  students: Array<{ id: number }>,
  existingRecords?: Array<{ student_id: number; status: string }>
): Record<number, AttendanceStatus> {
  const result: Record<number, AttendanceStatus> = {}

  if (existingRecords && existingRecords.length > 0) {
    const existingMap = new Map(existingRecords.map(r => [r.student_id, r.status as AttendanceStatus]))
    students.forEach(s => {
      result[s.id] = existingMap.get(s.id) ?? 'present'
    })
  } else {
    students.forEach(s => {
      result[s.id] = 'present'
    })
  }

  return result
}

/**
 * Computes live counters for total, present, and absent students.
 */
export function calculateAttendanceCounts(
  totalCount: number,
  rosterStatus: Record<number, AttendanceStatus>
): { total: number; present: number; absent: number } {
  let present = 0
  let absent = 0

  Object.values(rosterStatus).forEach(status => {
    if (status === 'present') {
      present++
    } else if (status === 'absent') {
      absent++
    }
  })

  // In case some students are not yet in rosterStatus, assume default present
  const unassigned = Math.max(0, totalCount - (present + absent))
  present += unassigned

  return {
    total: totalCount,
    present,
    absent,
  }
}

/**
 * Toggles status: 'present' -> 'absent', 'absent' -> 'present'.
 */
export function toggleAttendanceStatus(currentStatus?: AttendanceStatus): AttendanceStatus {
  return currentStatus === 'absent' ? 'present' : 'absent'
}

/**
 * Filters the roster to return only students who are currently marked absent.
 */
export function getAbsentStudents<T extends { id: number }>(
  students: T[],
  rosterStatus: Record<number, AttendanceStatus>
): T[] {
  return students.filter(s => rosterStatus[s.id] === 'absent')
}

/**
 * Validates session setup before marking or submitting attendance.
 */
export function validateSessionSetup(params: {
  assignmentId: number | null
  date: string
  sessionType: SessionType
  todayISO: string
}): { isValid: boolean; error?: string } {
  if (!params.assignmentId) {
    return { isValid: false, error: 'Please select a class and subject teaching assignment.' }
  }

  if (!params.date) {
    return { isValid: false, error: 'Please specify an attendance date.' }
  }

  if (params.date > params.todayISO) {
    return { isValid: false, error: 'Cannot record attendance for a future date.' }
  }

  if (!['lecture', 'practical', 'tutorial'].includes(params.sessionType)) {
    return { isValid: false, error: 'Invalid session type selected.' }
  }

  return { isValid: true }
}
