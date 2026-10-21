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
  /** Session ID that currentRoster was initialized for. Used to verify roster identity */
  currentRosterSessionId?: number | null | undefined
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
 * 2. On initial query error (no existing records), return QUERY_FAILED with canRetry: true.
 * 3. The READY branch delegates strictly to initRosterStatus in attendanceWorkflow.ts.
 * 4. Behavior for students missing from saved records (partial records):
 *    initRosterStatus restores saved statuses and defaults any missing student to 'present'.
 * 5. Identity-aware in-memory preservation:
 *    - When currentRoster matches the active session identity (currentRosterSessionId === sessionId),
 *      neither a successful background refetch nor a failed background refetch will overwrite
 *      the professor's in-memory edits.
 *    - When the session identity changes (e.g. date change resolves to a different existing session),
 *      the previous session's roster is discarded and the new session's saved statuses are restored.
 * 6. Fresh mount with cached records and failed refetch:
 *    - If usable records exist (existingRecords !== undefined), the roster is initialized from
 *      those records even if isRecordsError is true (background refetch failed).
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
    currentRosterSessionId,
  } = input

  // Check if in-memory roster belongs to the active session.
  // Fail-closed: an in-memory roster is preserved ONLY when its identity is explicitly
  // established as matching the active session. If currentRosterSessionId is undefined
  // (unestablished / missing identity), it is never treated as a match.
  const hasInMemoryRoster = !!currentRoster && Object.keys(currentRoster).length > 0
  const hasActiveSessionId = sessionId !== null && sessionId !== undefined
  const isRosterMatchingSession =
    currentRosterSessionId !== undefined &&
    (hasActiveSessionId
      ? currentRosterSessionId === sessionId
      : currentRosterSessionId === null)

  // Preserve in-memory edits ONLY when the roster explicitly matches the active session
  if (hasInMemoryRoster && isRosterMatchingSession) {
    return {
      state: 'READY',
      roster: currentRoster!,
      source: 'in_memory_preserved',
    }
  }

  // ─── Case 1: Existing session (draft, submitted, or locked) ────────
  if (sessionId !== null && sessionId !== undefined) {
    // If usable records are already available (from cache or successful fetch):
    // Always initialize/restore from them, even if a subsequent background refetch failed
    if (existingRecords !== undefined) {
      const restoredRoster = initRosterStatus(students, existingRecords)
      return {
        state: 'READY',
        roster: restoredRoster,
        source: 'existing_restored',
      }
    }

    // Records are not yet available:
    // If query is actively loading on initial fetch, wait
    if (isRecordsLoading) {
      return { state: 'WAITING_FOR_QUERY' }
    }

    // If query failed on initial fetch with no cached data, report failure
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
    return {
      state: 'QUERY_FAILED',
      errorMessage: 'Existing attendance records could not be verified.',
      canRetry: true,
    }
  }

  // ─── Case 2: New session setup (sessionId is null or undefined) ────
  const newRoster = initRosterStatus(students, undefined)
  return {
    state: 'READY',
    roster: newRoster,
    source: 'new_defaults',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE SAVE-GUARD SPECIFICATION & IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Custom error class for pure domain guard rejections.
 * Distinct from remote request / network / server errors.
 */
export class AttendanceGuardError extends Error {
  readonly code: string
  constructor(message: string, code = 'GUARD_REJECTED') {
    super(message)
    this.name = 'AttendanceGuardError'
    this.code = code
  }
}

export interface SaveGuardInput {
  operation: 'save_draft' | 'submit' | 'correct'
  sessionId: number | null | undefined
  isSubmitted: boolean
  isLocked: boolean
  studentsCount: number
  hasInMemoryRoster: boolean
  isRosterMatchingSession: boolean
  existingRecords: Array<{ student_id: number; status: string }> | undefined
  isRecordsLoading: boolean
  isRecordsError: boolean
  editReason?: string
}

export interface SaveGuardResolution {
  allowed: boolean
  code?:
    | 'EMPTY_ROSTER'
    | 'LOCKED'
    | 'ALREADY_SUBMITTED'
    | 'NOT_SUBMITTED'
    | 'REASON_REQUIRED'
    | 'UNRESOLVED_RECORDS'
    | 'RECORD_BASELINE_MISSING'
  reason?: string
}

/**
 * Pure evaluation function for save, submit, and correction actions.
 *
 * Rules:
 * - Case A (Save Draft):
 *   - Allowed for new sessions and existing drafts.
 *   - Blocked if session is already submitted or locked.
 *   - Not blocked merely because a redundant records refetch is pending after
 *     the session ID was just created (identity-matched).
 *   - Blocked if an existing session's records are unresolved (loading, failed, or not loaded/unstarted).
 *
 * - Case B (Initial Submission):
 *   - Allowed for new sessions and unsubmitted drafts with an initialized roster.
 *   - Immediate submit after the first Save Draft is allowed without waiting for
 *     a redundant records refetch (identity-matched).
 *   - Blocked if session is already submitted or locked.
 *   - Blocked if an existing session's records are unresolved (loading, failed, or not loaded/unstarted).
 *
 * - Case C (Correction of Submitted Session):
 *   - Blocked if session is not submitted or if session is locked.
 *   - Blocked if mandatory correction reason is empty.
 *   - Blocked if saved records baseline is unavailable or uncertain due to query error.
 */
export function evaluateAttendanceSaveAction(input: SaveGuardInput): SaveGuardResolution {
  const {
    operation,
    sessionId,
    isSubmitted,
    isLocked,
    studentsCount,
    hasInMemoryRoster,
    isRosterMatchingSession,
    existingRecords,
    isRecordsLoading,
    isRecordsError,
    editReason,
  } = input

  // Roster completeness
  if (studentsCount === 0 || !hasInMemoryRoster) {
    return {
      allowed: false,
      code: 'EMPTY_ROSTER',
      reason: 'No attendance data available to save.',
    }
  }

  // Session lock enforcement
  if (isLocked) {
    return {
      allowed: false,
      code: 'LOCKED',
      reason: 'This session is locked and can no longer be modified.',
    }
  }

  // ─── Case A: Save Draft ─────────────────────────────────────────────
  if (operation === 'save_draft') {
    if (isSubmitted) {
      return {
        allowed: false,
        code: 'ALREADY_SUBMITTED',
        reason: 'Cannot save draft for an already submitted session.',
      }
    }

    if (sessionId !== null && sessionId !== undefined) {
      // If we don't have an identity-matched in-memory roster for this session:
      if (!isRosterMatchingSession) {
        if (existingRecords === undefined) {
          if (isRecordsError) {
            return {
              allowed: false,
              code: 'UNRESOLVED_RECORDS',
              reason: 'Cannot save draft because existing session records could not be loaded.',
            }
          }
          if (isRecordsLoading) {
            return {
              allowed: false,
              code: 'UNRESOLVED_RECORDS',
              reason: 'Existing attendance records are still loading.',
            }
          }
          // Query not started, disabled, or returned no data yet
          return {
            allowed: false,
            code: 'UNRESOLVED_RECORDS',
            reason: 'Existing attendance records have not been loaded for this session.',
          }
        }
      }
    }

    return { allowed: true }
  }

  // ─── Case B: Initial Submission ─────────────────────────────────────
  if (operation === 'submit') {
    if (isSubmitted) {
      return {
        allowed: false,
        code: 'ALREADY_SUBMITTED',
        reason: 'This session has already been submitted.',
      }
    }

    if (sessionId !== null && sessionId !== undefined) {
      // If we don't have an identity-matched in-memory roster for this session:
      if (!isRosterMatchingSession) {
        if (existingRecords === undefined) {
          if (isRecordsError) {
            return {
              allowed: false,
              code: 'UNRESOLVED_RECORDS',
              reason: 'Cannot submit attendance because session records could not be loaded.',
            }
          }
          if (isRecordsLoading) {
            return {
              allowed: false,
              code: 'UNRESOLVED_RECORDS',
              reason: 'Existing attendance records are still loading.',
            }
          }
          // Query not started, disabled, or returned no data yet
          return {
            allowed: false,
            code: 'UNRESOLVED_RECORDS',
            reason: 'Existing attendance records have not been loaded for this session.',
          }
        }
      }
    }

    return { allowed: true }
  }

  // ─── Case C: Correction of Already Submitted Session ─────────────────
  if (operation === 'correct') {
    if (!isSubmitted) {
      return {
        allowed: false,
        code: 'NOT_SUBMITTED',
        reason: 'Session is not submitted. Use standard submission instead.',
      }
    }

    // Reason is strictly mandatory
    if (!editReason || !editReason.trim()) {
      return {
        allowed: false,
        code: 'REASON_REQUIRED',
        reason: 'A mandatory reason is required for attendance corrections.',
      }
    }

    // Saved records baseline is required to calculate accurate audit diffs
    if (existingRecords === undefined) {
      return {
        allowed: false,
        code: 'RECORD_BASELINE_MISSING',
        reason: 'Original attendance records are required to calculate correction audit logs.',
      }
    }

    // If query is in error state on a submitted session, the baseline is uncertain on server
    if (isRecordsError) {
      return {
        allowed: false,
        code: 'RECORD_BASELINE_MISSING',
        reason: 'Unable to verify saved records against the server. Please retry loading records before submitting corrections.',
      }
    }

    return { allowed: true }
  }

  return { allowed: false, reason: 'Unknown operation' }
}
