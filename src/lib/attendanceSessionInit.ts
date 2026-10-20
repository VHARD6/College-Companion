import type { AttendanceStatus } from '../types'
import { initRosterStatus } from './attendanceWorkflow.ts'

export interface ResolveRosterStateInput {
  /** The session ID if opening an existing draft or submitted session; null/undefined for a new session */
  sessionId: number | null | undefined
  /** List of enrolled students for the class/batch */
  students: Array<{ id: number; roll_no: string }>
  /** Existing attendance records fetched from Supabase, or undefined if not yet loaded/failed */
  existingRecords: Array<{ student_id: number; status: string }> | undefined
  /** Whether the attendance-records query is actively fetching */
  isRecordsLoading: boolean
  /** Whether the attendance-records query encountered an error */
  isRecordsError: boolean
  /** Error object from the query if isRecordsError is true */
  recordsError?: unknown
  /** In-memory roster state already held by the component, if any */
  currentRoster?: Record<number, AttendanceStatus> | null
  /** Session status if existing ('draft' | 'submitted' | 'cancelled') */
  sessionStatus?: string | null
}

export type RosterInitResolution =
  | { state: 'WAITING_FOR_QUERY' }
  | { state: 'QUERY_FAILED'; errorMessage: string; canRetry: boolean }
  | {
      state: 'READY'
      roster: Record<number, AttendanceStatus>
      source: 'existing_restored' | 'new_defaults' | 'in_memory_preserved'
    }

/**
 * Pure helper to resolve the roster initialization state safely.
 *
 * Safety guarantees:
 * 1. For any existing session (sessionId is present), NEVER default to all-present
 *    when the records query is still loading, has failed, or returned undefined.
 * 2. On query error, return QUERY_FAILED with an explicit error message and canRetry: true.
 * 3. The READY branch delegates strictly to the existing initRosterStatus in attendanceWorkflow.ts.
 * 4. Behavior for students missing from saved records (partial records):
 *    In accordance with College Companion's existing roster policy, when an existing session
 *    has saved records for only a subset of enrolled students, initRosterStatus restores the
 *    saved statuses for recorded students and defaults any missing student to 'present'.
 * 5. In-memory preservation: If the roster has already been initialized and contains in-memory
 *    edits, a background refetch will not overwrite those changes unless explicitly re-initialized.
 */
export function resolveRosterInitializationState(
  input: ResolveRosterStateInput
): RosterInitResolution {
  const {
    sessionId,
    students,
    existingRecords,
    isRecordsLoading,
    isRecordsError,
    recordsError,
    currentRoster,
  } = input

  // If in-memory roster is already populated, preserve it (e.g. during background refetches)
  if (currentRoster && Object.keys(currentRoster).length > 0) {
    return {
      state: 'READY',
      roster: currentRoster,
      source: 'in_memory_preserved',
    }
  }

  // Case 1: Existing session (draft, submitted, or locked)
  if (sessionId !== null && sessionId !== undefined) {
    // If the records query is currently loading, wait; never assume defaults
    if (isRecordsLoading) {
      return { state: 'WAITING_FOR_QUERY' }
    }

    // If the records query failed, report error; NEVER initialize all-present
    if (isRecordsError) {
      const msg =
        typeof recordsError === 'object' && recordsError !== null && 'message' in recordsError
          ? String((recordsError as any).message)
          : 'Failed to load attendance records for this session.'
      return {
        state: 'QUERY_FAILED',
        errorMessage: msg || 'Database query error while loading attendance records.',
        canRetry: true,
      }
    }

    // If loading finished but existingRecords is still undefined, treat as query failure
    if (existingRecords === undefined) {
      return {
        state: 'QUERY_FAILED',
        errorMessage: 'Existing attendance records could not be verified.',
        canRetry: true,
      }
    }

    // Records loaded successfully: call the existing initRosterStatus in attendanceWorkflow.ts
    // For partial records, initRosterStatus restores known records and assigns 'present' to missing students.
    const restoredRoster = initRosterStatus(students, existingRecords)
    return {
      state: 'READY',
      roster: restoredRoster,
      source: 'existing_restored',
    }
  }

  // Case 2: New session setup (sessionId is null or undefined)
  // Call existing initRosterStatus with no existingRecords to default all enrolled students to 'present'
  const newRoster = initRosterStatus(students, undefined)
  return {
    state: 'READY',
    roster: newRoster,
    source: 'new_defaults',
  }
}
