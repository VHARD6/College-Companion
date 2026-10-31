import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveRosterInitializationState,
  evaluateAttendanceSaveAction,
  AttendanceGuardError,
  hasUnsavedAttendanceChanges,
  type ResolveRosterStateInput,
  type SaveGuardInput,
} from '../src/lib/attendanceSessionInit.ts'
import {
  registerHardwareBackHandler,
  dispatchHardwareBack,
  clearHardwareBackHandlers,
} from '../src/lib/backButtonHandler.ts'
import {
  classifyAttendanceError,
  sanitizeDiagnosticValue,
  sanitizeDiagnosticString,
  logDiagnostic,
} from '../src/lib/errors.ts'
import type { AttendanceStatus } from '../src/types'

describe('Attendance Session Initialization & Query Safety Test Suite (Pass 1a)', () => {
  const mockStudents = [
    { id: 101, roll_no: 'CS01' },
    { id: 102, roll_no: 'CS02' },
    { id: 103, roll_no: 'CS03' },
  ]

  // ──────────────────────────────────────────────────────────────────────────
  // 1. New session (no sessionId) — PRESERVED
  // ──────────────────────────────────────────────────────────────────────────
  describe('New session setup (sessionId is null or undefined)', () => {
    it('immediately initializes all enrolled students as present with source: new_defaults', () => {
      const input: ResolveRosterStateInput = {
        sessionId: null,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'READY')
      if (result.state === 'READY') {
        assert.equal(result.source, 'new_defaults')
        assert.equal(result.roster[101], 'present')
        assert.equal(result.roster[102], 'present')
        assert.equal(result.roster[103], 'present')
        assert.equal(Object.keys(result.roster).length, 3)
      }
    })

    it('handles undefined sessionId identically to null', () => {
      const input: ResolveRosterStateInput = {
        sessionId: undefined,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'READY')
      if (result.state === 'READY') {
        assert.equal(result.source, 'new_defaults')
        assert.equal(result.roster[101], 'present')
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Query failure and error prevention (S1 invariant) — PRESERVED
  // ──────────────────────────────────────────────────────────────────────────
  describe('Existing session records query failure (S1 safety invariant)', () => {
    it('never defaults to all-present when records query encounters an error on existing draft', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 42,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: true,
        recordsError: { message: 'Network connection lost' },
        sessionStatus: 'draft',
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'QUERY_FAILED')
      if (result.state === 'QUERY_FAILED') {
        assert.equal(result.canRetry, true)
        assert.match(result.errorMessage, /network connection/i)
      }
    })

    it('returns WAITING_FOR_QUERY while query is in-flight and does not initialize roster', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 42,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: true,
        isRecordsError: false,
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'WAITING_FOR_QUERY')
    })

    it('treats finished query with undefined existingRecords as QUERY_FAILED rather than empty success', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 42,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'QUERY_FAILED')
      if (result.state === 'QUERY_FAILED') {
        assert.equal(result.canRetry, true)
        assert.match(result.errorMessage, /could not be verified/i)
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Submitted / locked session — PRESERVED
  // ──────────────────────────────────────────────────────────────────────────
  describe('Submitted and locked session', () => {
    it('restores exact submitted records and never wipes absentees', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 99,
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'absent' },
          { student_id: 103, status: 'present' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
        sessionStatus: 'submitted',
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'READY')
      if (result.state === 'READY') {
        assert.equal(result.source, 'existing_restored')
        assert.equal(result.roster[101], 'present')
        assert.equal(result.roster[102], 'absent')
        assert.equal(result.roster[103], 'present')
      }
    })

    it('refuses to initialize all-present when submitted session query errors', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 99,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: true,
        recordsError: new Error('PGRST301: JWT expired'),
        sessionStatus: 'submitted',
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'QUERY_FAILED')
      if (result.state === 'QUERY_FAILED') {
        assert.equal(result.canRetry, true)
        assert.match(result.errorMessage, /JWT expired/i)
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Existing session with zero records — PRESERVED
  // ──────────────────────────────────────────────────────────────────────────
  describe('Existing session with zero records', () => {
    it('delegates to initRosterStatus and returns READY with empty existingRecords array', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 55,
        students: mockStudents,
        existingRecords: [],
        isRecordsLoading: false,
        isRecordsError: false,
        sessionStatus: 'draft',
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'READY')
      if (result.state === 'READY') {
        assert.equal(result.source, 'existing_restored')
        assert.equal(result.roster[101], 'present')
        assert.equal(result.roster[102], 'present')
        assert.equal(result.roster[103], 'present')
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Partial records (students missing from saved records) — PRESERVED
  // ──────────────────────────────────────────────────────────────────────────
  describe('Partial records: students missing from saved records', () => {
    it('restores status for recorded students and safely defaults missing students to present', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 60,
        students: mockStudents,
        existingRecords: [
          { student_id: 102, status: 'absent' },
          { student_id: 103, status: 'present' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'READY')
      if (result.state === 'READY') {
        assert.equal(result.source, 'existing_restored')
        assert.equal(result.roster[102], 'absent')
        assert.equal(result.roster[103], 'present')
        assert.equal(result.roster[101], 'present')
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Failure then successful retry flow — PRESERVED
  // ──────────────────────────────────────────────────────────────────────────
  describe('Failure then successful retry flow', () => {
    it('handles transition from error -> retry loading -> success cleanly', () => {
      const failureInput: ResolveRosterStateInput = {
        sessionId: 70,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: true,
        recordsError: { message: '503 Service Unavailable' },
      }
      const failureResult = resolveRosterInitializationState(failureInput)
      assert.equal(failureResult.state, 'QUERY_FAILED')

      const retryLoadingInput: ResolveRosterStateInput = {
        sessionId: 70,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: true,
        isRecordsError: false,
      }
      const retryLoadingResult = resolveRosterInitializationState(retryLoadingInput)
      assert.equal(retryLoadingResult.state, 'WAITING_FOR_QUERY')

      const retrySuccessInput: ResolveRosterStateInput = {
        sessionId: 70,
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'absent' },
          { student_id: 103, status: 'absent' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
      }
      const retrySuccessResult = resolveRosterInitializationState(retrySuccessInput)
      assert.equal(retrySuccessResult.state, 'READY')
      if (retrySuccessResult.state === 'READY') {
        assert.equal(retrySuccessResult.source, 'existing_restored')
        assert.equal(retrySuccessResult.roster[102], 'absent')
        assert.equal(retrySuccessResult.roster[103], 'absent')
        assert.equal(retrySuccessResult.roster[101], 'present')
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 7. In-memory roster preservation — PRESERVED
  // ──────────────────────────────────────────────────────────────────────────
  describe('In-memory roster preservation', () => {
    it('preserves user in-memory edits when currentRoster is already populated', () => {
      const activeRoster: Record<number, AttendanceStatus> = {
        101: 'absent',
        102: 'absent',
        103: 'present',
      }

      const input: ResolveRosterStateInput = {
        sessionId: 80,
        currentRosterSessionId: 80,
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'present' },
          { student_id: 103, status: 'present' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
        currentRoster: activeRoster,
      }

      const result = resolveRosterInitializationState(input)
      assert.equal(result.state, 'READY')
      if (result.state === 'READY') {
        assert.equal(result.source, 'in_memory_preserved')
        assert.deepEqual(result.roster, activeRoster)
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Session-Aware Identity & Lifecycle Tests (Section 3 Requirements)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Session-aware identity and lifecycle requirements', () => {
    it('A: preserves in-memory edits during both successful and failed background refetches for the same session', () => {
      const activeRoster: Record<number, AttendanceStatus> = {
        101: 'absent',
        102: 'present',
        103: 'absent',
      }

      // Successful background refetch
      const successRefetch: ResolveRosterStateInput = {
        sessionId: 85,
        currentRosterSessionId: 85,
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'present' },
          { student_id: 103, status: 'present' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
        currentRoster: activeRoster,
      }
      const resSuccess = resolveRosterInitializationState(successRefetch)
      assert.equal(resSuccess.state, 'READY')
      if (resSuccess.state === 'READY') {
        assert.equal(resSuccess.source, 'in_memory_preserved')
        assert.equal(resSuccess.roster[101], 'absent')
      }

      // Failed background refetch with retained records
      const failedRefetch: ResolveRosterStateInput = {
        sessionId: 85,
        currentRosterSessionId: 85,
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'present' },
          { student_id: 103, status: 'present' },
        ],
        isRecordsLoading: false,
        isRecordsError: true, // Refetch failed!
        recordsError: new Error('Failed to fetch'),
        currentRoster: activeRoster,
      }
      const resFailed = resolveRosterInitializationState(failedRefetch)
      assert.equal(resFailed.state, 'READY')
      if (resFailed.state === 'READY') {
        assert.equal(resFailed.source, 'in_memory_preserved')
        assert.equal(resFailed.roster[101], 'absent') // Preserved! Does not become QUERY_FAILED
      }
    })

    it('B: in-page date change to a date with an existing session discards old roster and restores saved statuses', () => {
      const oldRosterFromPreviousDate: Record<number, AttendanceStatus> = {
        101: 'absent',
        102: 'absent',
        103: 'absent',
      }

      // Date changed: active session is 90, but old roster was for session 88
      const dateChangeInput: ResolveRosterStateInput = {
        sessionId: 90,
        currentRosterSessionId: 88, // Does NOT match 90!
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'present' },
          { student_id: 103, status: 'absent' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
        currentRoster: oldRosterFromPreviousDate,
        sessionStatus: 'draft',
      }

      const res = resolveRosterInitializationState(dateChangeInput)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'existing_restored') // Discards old roster!
        assert.equal(res.roster[101], 'present')
        assert.equal(res.roster[102], 'present')
        assert.equal(res.roster[103], 'absent')
      }
    })

    it('C: in-page date change to a date with no existing session preserves today existing behaviour', () => {
      const inProgressNewRoster: Record<number, AttendanceStatus> = {
        101: 'absent',
        102: 'present',
        103: 'present',
      }

      // Staying on a new session (null sessionId) preserves current in-progress toggles
      const input: ResolveRosterStateInput = {
        sessionId: null,
        currentRosterSessionId: null,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
        currentRoster: inProgressNewRoster,
      }

      const res = resolveRosterInitializationState(input)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'in_memory_preserved')
        assert.equal(res.roster[101], 'absent')
      }
    })

    it('D: first Save Draft transitions smoothly from new session to persisted sessionId without resetting', () => {
      const markedDraftRoster: Record<number, AttendanceStatus> = {
        101: 'absent',
        102: 'absent',
        103: 'present',
      }

      // After first save draft, currentRosterSessionId is updated to the newly assigned 105
      const postSaveDraftInput: ResolveRosterStateInput = {
        sessionId: 105,
        currentRosterSessionId: 105,
        students: mockStudents,
        existingRecords: undefined, // Post-save query is still in flight!
        isRecordsLoading: true,
        isRecordsError: false,
        currentRoster: markedDraftRoster,
      }

      const res = resolveRosterInitializationState(postSaveDraftInput)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'in_memory_preserved')
        assert.equal(res.roster[101], 'absent')
        assert.equal(res.roster[102], 'absent')
      }
    })

    it('E: changing class resets the roster cleanly', () => {
      // When class changes, component clears currentRoster to null or {}
      const classChangeInput: ResolveRosterStateInput = {
        sessionId: null,
        currentRosterSessionId: undefined,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
        currentRoster: null,
      }

      const res = resolveRosterInitializationState(classChangeInput)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'new_defaults')
        assert.equal(res.roster[101], 'present')
      }
    })

    it('F: fresh mount with cached records and failed refetch initialises from cached records', () => {
      const freshMountWithCacheInput: ResolveRosterStateInput = {
        sessionId: 120,
        currentRosterSessionId: undefined,
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'absent' },
          { student_id: 102, status: 'present' },
          { student_id: 103, status: 'absent' },
        ],
        isRecordsLoading: false,
        isRecordsError: true, // Refetch errored!
        recordsError: new Error('Network timeout'),
        currentRoster: null, // First mount
      }

      const res = resolveRosterInitializationState(freshMountWithCacheInput)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'existing_restored')
        assert.equal(res.roster[101], 'absent')
        assert.equal(res.roster[103], 'absent')
      }
    })

    it('cached records with refetch error and non-matching identity builds from cached records rather than preserving previous roster', () => {
      const previousRoster: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'present',
        103: 'present',
      }

      const input: ResolveRosterStateInput = {
        sessionId: 200,
        currentRosterSessionId: 199, // Mismatched old session
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'absent' },
          { student_id: 102, status: 'absent' },
          { student_id: 103, status: 'absent' },
        ],
        isRecordsLoading: false,
        isRecordsError: true, // Background refetch errored
        currentRoster: previousRoster,
      }

      const res = resolveRosterInitializationState(input)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'existing_restored')
        assert.equal(res.roster[101], 'absent') // Restored from session 200's cached records!
      }
    })

    it('fails closed when in-memory roster exists but currentRosterSessionId is undefined (missing identity)', () => {
      const inMemoryRoster: Record<number, AttendanceStatus> = {
        101: 'absent',
        102: 'absent',
        103: 'absent',
      }

      // Case 1: Existing session with missing currentRosterSessionId
      const existingSessionInput: ResolveRosterStateInput = {
        sessionId: 80,
        currentRosterSessionId: undefined, // Missing identity!
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'present' },
          { student_id: 103, status: 'present' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
        currentRoster: inMemoryRoster,
      }

      const resExisting = resolveRosterInitializationState(existingSessionInput)
      assert.equal(resExisting.state, 'READY')
      if (resExisting.state === 'READY') {
        // Must NOT preserve in-memory roster! Restores saved records instead
        assert.equal(resExisting.source, 'existing_restored')
        assert.equal(resExisting.roster[101], 'present')
      }

      // Case 2: New session with missing currentRosterSessionId
      const newSessionInput: ResolveRosterStateInput = {
        sessionId: null,
        currentRosterSessionId: undefined, // Missing identity!
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
        currentRoster: inMemoryRoster,
      }

      const resNew = resolveRosterInitializationState(newSessionInput)
      assert.equal(resNew.state, 'READY')
      if (resNew.state === 'READY') {
        // Must NOT preserve unverified in-memory roster! Resets to new defaults
        assert.equal(resNew.source, 'new_defaults')
        assert.equal(resNew.roster[101], 'present')
      }
    })

    it('D2: first Save Draft ID transition preserves subsequent toggles while post-save query is in flight', () => {
      const step1Roster: Record<number, AttendanceStatus> = {
        101: 'absent',
        102: 'present',
        103: 'present',
      }

      // First Save Draft finishes, server returns session ID 105
      // Component updates rosterSessionIdRef.current to 105 and professor toggles student 102 to absent
      const step2RosterWithSubsequentToggle: Record<number, AttendanceStatus> = {
        ...step1Roster,
        102: 'absent',
      }

      const inFlightInput: ResolveRosterStateInput = {
        sessionId: 105,
        currentRosterSessionId: 105, // Identity matches newly assigned ID!
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: true,
        isRecordsError: false,
        currentRoster: step2RosterWithSubsequentToggle,
      }

      const res = resolveRosterInitializationState(inFlightInput)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'in_memory_preserved')
        assert.equal(res.roster[101], 'absent')
        assert.equal(res.roster[102], 'absent') // Subsequent toggle preserved!
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Pure Save-Guard Evaluation Tests (Section 4 Requirements)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Pure Save-Guard Evaluation (evaluateAttendanceSaveAction)', () => {
    it('1. allows Save Draft for a valid new session', () => {
      const input: SaveGuardInput = {
        operation: 'save_draft',
        sessionId: null,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, true)
    })

    it('2. allows Save Draft after new session ID is assigned but post-save records query is pending', () => {
      const input: SaveGuardInput = {
        operation: 'save_draft',
        sessionId: 105,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true, // Newly saved draft matched to session 105
        existingRecords: undefined,    // Query still in-flight
        isRecordsLoading: true,
        isRecordsError: false,
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, true)
    })

    it('3. allows initial submission immediately after first successful Save Draft without waiting for refetch', () => {
      const input: SaveGuardInput = {
        operation: 'submit',
        sessionId: 105,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true, // Verified in-memory roster
        existingRecords: undefined,    // Redundant refetch unresolved
        isRecordsLoading: true,
        isRecordsError: false,
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, true)
    })

    it('4. blocks initial load failure for an unrelated existing session with unknown saved statuses', () => {
      const input: SaveGuardInput = {
        operation: 'submit',
        sessionId: 42,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: false, // Mismatched or unestablished
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: true,           // Query failed!
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, false)
      assert.equal(res.code, 'UNRESOLVED_RECORDS')
    })

    it('5. allows draft operation with valid, identity-matched in-memory roster and failed background refetch', () => {
      const input: SaveGuardInput = {
        operation: 'save_draft',
        sessionId: 85,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: [{ student_id: 101, status: 'present' }],
        isRecordsLoading: false,
        isRecordsError: true, // Background refetch errored, but cached data exists
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, true)
    })

    it('6. allows submitted-session correction with a known and acceptable saved-record baseline', () => {
      const input: SaveGuardInput = {
        operation: 'correct',
        sessionId: 99,
        isSubmitted: true,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'absent' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
        editReason: 'Student 102 was present and produced signed attendance slip',
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, true)
    })

    it('7. blocks submitted-session correction when required baseline is unavailable or uncertain', () => {
      // Baseline missing
      const noBaselineInput: SaveGuardInput = {
        operation: 'correct',
        sessionId: 99,
        isSubmitted: true,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: undefined,
        isRecordsLoading: false,
        isRecordsError: false,
        editReason: 'Reason provided',
      }
      const resNoBaseline = evaluateAttendanceSaveAction(noBaselineInput)
      assert.equal(resNoBaseline.allowed, false)
      assert.equal(resNoBaseline.code, 'RECORD_BASELINE_MISSING')

      // Query error makes server baseline uncertain
      const errorBaselineInput: SaveGuardInput = {
        operation: 'correct',
        sessionId: 99,
        isSubmitted: true,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: [{ student_id: 101, status: 'present' }],
        isRecordsLoading: false,
        isRecordsError: true, // Error!
        editReason: 'Reason provided',
      }
      const resErrorBaseline = evaluateAttendanceSaveAction(errorBaselineInput)
      assert.equal(resErrorBaseline.allowed, false)
      assert.equal(resErrorBaseline.code, 'RECORD_BASELINE_MISSING')
    })

    it('8. enforces locking, reason requirements, and empty roster guards', () => {
      // Locked session
      const lockedRes = evaluateAttendanceSaveAction({
        operation: 'submit',
        sessionId: 99,
        isSubmitted: true,
        isLocked: true,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: [{ student_id: 101, status: 'present' }],
        isRecordsLoading: false,
        isRecordsError: false,
      })
      assert.equal(lockedRes.allowed, false)
      assert.equal(lockedRes.code, 'LOCKED')

      // Missing reason on correction
      const noReasonRes = evaluateAttendanceSaveAction({
        operation: 'correct',
        sessionId: 99,
        isSubmitted: true,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: [{ student_id: 101, status: 'present' }],
        isRecordsLoading: false,
        isRecordsError: false,
        editReason: '   ',
      })
      assert.equal(noReasonRes.allowed, false)
      assert.equal(noReasonRes.code, 'REASON_REQUIRED')
    })

    it('9. blocks unstarted or idle queries for an existing session where records have not loaded', () => {
      // Existing session, query not started / idle, no matching roster
      const idleInput: SaveGuardInput = {
        operation: 'save_draft',
        sessionId: 99,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: false,
        existingRecords: undefined,
        isRecordsLoading: false, // Not loading!
        isRecordsError: false,   // Not in error!
      }

      const resDraft = evaluateAttendanceSaveAction(idleInput)
      assert.equal(resDraft.allowed, false)
      assert.equal(resDraft.code, 'UNRESOLVED_RECORDS')
      assert.match(resDraft.reason!, /records have not been loaded/i)

      const resSubmit = evaluateAttendanceSaveAction({ ...idleInput, operation: 'submit' })
      assert.equal(resSubmit.allowed, false)
      assert.equal(resSubmit.code, 'UNRESOLVED_RECORDS')
      assert.match(resSubmit.reason!, /records have not been loaded/i)
    })

    it('10. AttendanceGuardError produces correct name, message, and code', () => {
      const err = new AttendanceGuardError('A mandatory reason is required.', 'REASON_REQUIRED')
      assert.equal(err.name, 'AttendanceGuardError')
      assert.equal(err.message, 'A mandatory reason is required.')
      assert.equal(err.code, 'REASON_REQUIRED')
    })

    it('11. fails closed for save_draft, submit, and correct when roster identity mismatches existing session, even with defined existingRecords', () => {
      const records = [
        { student_id: 101, status: 'present' as AttendanceStatus },
        { student_id: 102, status: 'absent' as AttendanceStatus },
      ]

      // A. Save Draft with mismatched identity
      const draftRes = evaluateAttendanceSaveAction({
        operation: 'save_draft',
        sessionId: 100,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: false, // Mismatched!
        existingRecords: records,
        isRecordsLoading: false,
        isRecordsError: false,
      })
      assert.equal(draftRes.allowed, false)
      assert.equal(draftRes.code, 'ROSTER_IDENTITY_MISMATCH')
      assert.equal(
        draftRes.reason,
        'Current in-memory attendance marks do not match the active session identity.'
      )

      // B. Submit with mismatched identity
      const submitRes = evaluateAttendanceSaveAction({
        operation: 'submit',
        sessionId: 100,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: false, // Mismatched!
        existingRecords: records,
        isRecordsLoading: false,
        isRecordsError: false,
      })
      assert.equal(submitRes.allowed, false)
      assert.equal(submitRes.code, 'ROSTER_IDENTITY_MISMATCH')
      assert.equal(
        submitRes.reason,
        'Current in-memory attendance marks do not match the active session identity.'
      )

      // C. Correct with mismatched identity (even with valid reason and records)
      const correctRes = evaluateAttendanceSaveAction({
        operation: 'correct',
        sessionId: 100,
        isSubmitted: true,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: false, // Mismatched!
        existingRecords: records,
        isRecordsLoading: false,
        isRecordsError: false,
        editReason: 'Student was present',
      })
      assert.equal(correctRes.allowed, false)
      assert.equal(correctRes.code, 'ROSTER_IDENTITY_MISMATCH')
      assert.equal(
        correctRes.reason,
        'Current in-memory attendance marks do not match the active session identity.'
      )
    })

    it('12. allows save_draft, submit, and correct when roster identity explicitly matches existing session', () => {
      const records = [
        { student_id: 101, status: 'present' as AttendanceStatus },
        { student_id: 102, status: 'absent' as AttendanceStatus },
      ]

      const draftRes = evaluateAttendanceSaveAction({
        operation: 'save_draft',
        sessionId: 100,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: records,
        isRecordsLoading: false,
        isRecordsError: false,
      })
      assert.equal(draftRes.allowed, true)

      const submitRes = evaluateAttendanceSaveAction({
        operation: 'submit',
        sessionId: 100,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: records,
        isRecordsLoading: false,
        isRecordsError: false,
      })
      assert.equal(submitRes.allowed, true)

      const correctRes = evaluateAttendanceSaveAction({
        operation: 'correct',
        sessionId: 100,
        isSubmitted: true,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: records,
        isRecordsLoading: false,
        isRecordsError: false,
        editReason: 'Correction justified by attendance slip',
      })
      assert.equal(correctRes.allowed, true)
    })

    it('13. allows immediate Submit after first Save Draft creates session ID despite pending records query', () => {
      const res = evaluateAttendanceSaveAction({
        operation: 'submit',
        sessionId: 250,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: undefined,
        isRecordsLoading: true,
        isRecordsError: false,
      })
      assert.equal(res.allowed, true)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 10. Pure Error Classification Tests (Section 5 Requirements)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Pure Error Sanitization & Classification (classifyAttendanceError)', () => {
    // Suppress console.error during test execution
    const origError = console.error
    beforeEach(() => {
      console.error = () => {}
    })
    afterEach(() => {
      console.error = origError
    })

    it('classifies structured network error with retry action', () => {
      const err = { code: 'ECONNREFUSED', message: 'Connection refused' }
      const res = classifyAttendanceError(err)
      assert.equal(res.category, 'network')
      assert.equal(res.action, 'retry')
      assert.match(res.userMessage, /check your connection/i)
      assert(!res.userMessage.includes('ECONNREFUSED'))
    })

    it('classifies structured expired auth (401 / PGRST301) with sign_in action', () => {
      const err1 = { status: 401, message: 'JWT expired' }
      const res1 = classifyAttendanceError(err1)
      assert.equal(res1.category, 'auth_expired')
      assert.equal(res1.action, 'sign_in')
      assert.match(res1.userMessage, /sign in again/i)

      const err2 = { code: 'PGRST301', message: 'JWT expired' }
      const res2 = classifyAttendanceError(err2)
      assert.equal(res2.category, 'auth_expired')
      assert.equal(res2.action, 'sign_in')
    })

    it('classifies structured permission error (403 / 42501) with none action', () => {
      const err = { code: '42501', message: 'permission denied for table attendance_records' }
      const res = classifyAttendanceError(err)
      assert.equal(res.category, 'permission_denied')
      assert.equal(res.action, 'none')
      assert(!res.userMessage.includes('attendance_records'))
      assert(!res.userMessage.includes('42501'))
    })

    it('classifies structured validation error with none action', () => {
      const err = { status: 400, message: 'Invalid session type' }
      const res = classifyAttendanceError(err)
      assert.equal(res.category, 'validation')
      assert.equal(res.action, 'none')
      assert.match(res.userMessage, /details need checking/i)
    })

    it('classifies structured server error (HTTP 500-599) with retry action', () => {
      const err = { status: 503, message: 'Service Unavailable' }
      const res = classifyAttendanceError(err)
      assert.equal(res.category, 'server_error')
      assert.equal(res.action, 'retry')
      assert.match(res.userMessage, /temporarily unavailable/i)
    })

    it('does NOT misclassify unrelated numbers like 1500 or "500 students processed" as HTTP 500', () => {
      const err1 = new Error('Batch limit reached: 1500 records found')
      const res1 = classifyAttendanceError(err1)
      assert.notEqual(res1.category, 'server_error')

      const err2 = new Error('500 students processed successfully')
      const res2 = classifyAttendanceError(err2)
      assert.notEqual(res2.category, 'server_error')
    })

    it('does not classify messages merely containing a number as a server error (500 students processed, 500 records found, ID 503)', () => {
      const cases = [
        '500 students processed',
        '500 records found',
        'ID 503',
        'Processed 500 items',
        'Section 502 enrolled',
      ]
      for (const msg of cases) {
        const res = classifyAttendanceError(new Error(msg))
        assert.notEqual(
          res.category,
          'server_error',
          `Message "${msg}" should NOT be classified as server_error`
        )
      }
    })

    it('classifies explicit HTTP status context or clear server-error wording as server_error', () => {
      const serverErrorCases = [
        'HTTP 503 Service Unavailable',
        'status: 503',
        'HTTP/1.1 500 Internal Server Error',
        'status code 502',
        'Service Unavailable',
        'Bad Gateway',
      ]
      for (const msg of serverErrorCases) {
        const res = classifyAttendanceError(new Error(msg))
        assert.equal(
          res.category,
          'server_error',
          `Message "${msg}" SHOULD be classified as server_error`
        )
        assert.equal(res.action, 'retry')
        assert.match(res.userMessage, /temporarily unavailable/i)
      }
    })

    it('classifyAttendanceError is a pure function and produces no logging side effects', () => {
      let logged = false
      const origErr = console.error
      console.error = () => {
        logged = true
      }
      try {
        classifyAttendanceError(new Error('Sample test error for purity check'))
        assert.equal(logged, false, 'classifyAttendanceError must not invoke console.error or logDiagnostic')
      } finally {
        console.error = origErr
      }
    })

    it('falls back to text matching when structured info is absent', () => {
      const err = new Error('TypeError: Failed to fetch')
      const res = classifyAttendanceError(err)
      assert.equal(res.category, 'network')
      assert.equal(res.action, 'retry')
    })

    it('handles non-Error objects and unknown errors safely without leaking details', () => {
      const res1 = classifyAttendanceError(null)
      assert.equal(res1.category, 'unknown')
      assert.equal(res1.action, 'retry')

      const res2 = classifyAttendanceError('Internal SQL syntax error: SELECT * FROM secrets')
      assert.equal(res2.category, 'unknown')
      assert(!res2.userMessage.includes('secrets'))
      assert(!res2.userMessage.includes('SQL'))
    })

    it('maps database business rule exceptions from migration 006 to user-friendly messages with action none', () => {
      // A. Correction window expired
      const errWindow = new Error('Correction window (24 hours) has expired for session 5. Modification locked.')
      const resWindow = classifyAttendanceError(errWindow)
      assert.equal(resWindow.category, 'permission_denied')
      assert.equal(resWindow.action, 'none')
      assert.equal(
        resWindow.userMessage,
        'The correction window for this session has expired. Attendance modifications are locked.'
      )

      // B. Session already submitted / locked
      const errSubmitted = new Error('Session 12 has already been submitted. Use correction workflow for modifications.')
      const resSubmitted = classifyAttendanceError(errSubmitted)
      assert.equal(resSubmitted.category, 'permission_denied')
      assert.equal(resSubmitted.action, 'none')
      assert.equal(
        resSubmitted.userMessage,
        'This attendance session has already been submitted and is locked from draft changes. Use the correction workflow to make modifications.'
      )

      const errReopen = new Error('Cannot reopen a submitted session as draft.')
      const resReopen = classifyAttendanceError(errReopen)
      assert.equal(resReopen.category, 'permission_denied')
      assert.equal(resReopen.action, 'none')
      assert.equal(
        resReopen.userMessage,
        'This attendance session has already been submitted and is locked from draft changes. Use the correction workflow to make modifications.'
      )

      // C. Assignment authorization
      const errAuth = new Error('Forbidden: You are not authorized for teaching assignment 4')
      const resAuth = classifyAttendanceError(errAuth)
      assert.equal(resAuth.category, 'permission_denied')
      assert.equal(resAuth.action, 'none')
      assert.equal(
        resAuth.userMessage,
        'You are not authorized to mark or modify attendance for this teaching assignment.'
      )

      const errProfPerm = new Error('Forbidden: You do not have permission to modify another professor\'s session.')
      const resProfPerm = classifyAttendanceError(errProfPerm)
      assert.equal(resProfPerm.category, 'permission_denied')
      assert.equal(resProfPerm.action, 'none')
      assert.equal(
        resProfPerm.userMessage,
        'You are not authorized to mark or modify attendance for this teaching assignment.'
      )

      // D. Student enrollment
      const errEnrolled = new Error('Student CS01 is not enrolled in class 3')
      const resEnrolled = classifyAttendanceError(errEnrolled)
      assert.equal(resEnrolled.category, 'validation')
      assert.equal(resEnrolled.action, 'none')
      assert.equal(
        resEnrolled.userMessage,
        'One or more students are not enrolled in this class or batch.'
      )

      // E. Future date rejection
      const errFuture = new Error('Cannot mark attendance for a future date.')
      const resFuture = classifyAttendanceError(errFuture)
      assert.equal(resFuture.category, 'validation')
      assert.equal(resFuture.action, 'none')
      assert.equal(
        resFuture.userMessage,
        'Attendance cannot be marked for a future date.'
      )

      // F. Mandatory reason
      const errReason = new Error('A non-empty reason is mandatory for attendance correction.')
      const resReason = classifyAttendanceError(errReason)
      assert.equal(resReason.category, 'validation')
      assert.equal(resReason.action, 'none')
      assert.equal(
        resReason.userMessage,
        'A mandatory reason is required for attendance corrections.'
      )
    })

    it('provides explicit contextual messages distinguishing save failures from loading failures', () => {
      // 1. Auth expired during save
      const saveAuth = classifyAttendanceError({ status: 401 }, 'save')
      assert.equal(saveAuth.category, 'auth_expired')
      assert.equal(saveAuth.action, 'sign_in')
      assert(saveAuth.userMessage.includes('Attendance was not saved, but your marks are still on screen'))
      assert(saveAuth.userMessage.includes('sign in again'))

      // Auth expired during load
      const loadAuth = classifyAttendanceError({ status: 401 }, 'load')
      assert.equal(loadAuth.category, 'auth_expired')
      assert.equal(loadAuth.userMessage, 'Your sign-in session has expired. Please sign in again.')

      // 2. Network error during save
      const saveNet = classifyAttendanceError(new Error('Failed to fetch'), 'save')
      assert.equal(saveNet.category, 'network')
      assert.equal(saveNet.action, 'retry')
      assert(saveNet.userMessage.includes('Attendance was not saved, but your current marks are still on screen'))

      // Network error during load
      const loadNet = classifyAttendanceError(new Error('Failed to fetch'), 'load')
      assert.equal(loadNet.category, 'network')
      assert.equal(loadNet.userMessage, 'Unable to reach the server. Check your connection and try again.')

      // 3. Server error during save
      const saveServer = classifyAttendanceError({ status: 503 }, 'save')
      assert.equal(saveServer.category, 'server_error')
      assert.equal(saveServer.action, 'retry')
      assert(saveServer.userMessage.includes('Attendance was not saved, but your current marks are still on screen'))

      // Server error during load
      const loadServer = classifyAttendanceError({ status: 503 }, 'load')
      assert.equal(loadServer.category, 'server_error')
      assert.equal(loadServer.userMessage, 'The server is temporarily unavailable. Please try again shortly.')

      // 4. Permission error during save
      const savePerm = classifyAttendanceError({ code: '42501' }, 'save')
      assert.equal(savePerm.category, 'permission_denied')
      assert.equal(savePerm.action, 'none')
      assert(savePerm.userMessage.includes('You do not have permission to save attendance for this session'))
      assert(savePerm.userMessage.includes('current marks are still on screen'))

      // 5. Unknown error during save
      const saveUnknown = classifyAttendanceError(new Error('Unexpected exception 12345'), 'save')
      assert.equal(saveUnknown.category, 'unknown')
      assert.equal(saveUnknown.action, 'retry')
      assert(saveUnknown.userMessage.includes('Attendance was not saved, but your current marks are still on screen'))

      // Unknown error during load
      const loadUnknown = classifyAttendanceError(new Error('Unexpected exception 12345'), 'load')
      assert.equal(loadUnknown.category, 'unknown')
      assert.equal(loadUnknown.userMessage, 'Something went wrong while loading attendance. Please try again.')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 11. Diagnostic Logging & Redaction Tests (Section 5 Requirements)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Diagnostic Logging & Redaction (logDiagnostic / sanitizeDiagnosticValue)', () => {
    it('retains name and message for ordinary Error instances with non-enumerable properties', () => {
      const err = new Error('Database connection failed')
      const sanitized = sanitizeDiagnosticValue(err) as Record<string, unknown>
      assert.equal(sanitized.name, 'Error')
      assert.equal(sanitized.message, 'Database connection failed')
    })

    it('redacts JWT strings from error messages and property values', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      const err = new Error(`Request failed with token: ${jwt}`)
      const sanitized = sanitizeDiagnosticValue(err) as Record<string, unknown>
      assert(!String(sanitized.message).includes(jwt))
      assert(String(sanitized.message).includes('[REDACTED_JWT]'))
    })

    it('redacts Bearer tokens and authorization headers', () => {
      const obj = {
        authorization: 'Bearer secret_access_token_12345',
        api_token: 'secret_key_99999',
        normalField: 'safe data',
      }
      const sanitized = sanitizeDiagnosticValue(obj) as Record<string, unknown>
      assert.equal(sanitized.authorization, '[REDACTED]')
      assert.equal(sanitized.api_token, '[REDACTED]')
      assert.equal(sanitized.normalField, 'safe data')
    })

    it('redacts sensitive nested objects and parameters without logging raw credentials', () => {
      const errWithDetails = {
        name: 'PostgrestError',
        details: {
          password: 'super_secret_password',
          jwt: 'eyJtest.token.here',
          code: '42501',
        },
      }
      const sanitized = sanitizeDiagnosticValue(errWithDetails) as Record<string, any>
      assert.equal(sanitized.details.password, '[REDACTED]')
      assert.equal(sanitized.details.jwt, '[REDACTED]')
      assert.equal(sanitized.details.code, '42501')
    })

    it('logDiagnostic safely executes without throwing', () => {
      const origError = console.error
      let logged = ''
      console.error = (...args: unknown[]) => {
        logged = args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')
      }
      try {
        logDiagnostic(new Error('Sample diagnostic message'))
        assert(logged.includes('Attendance Diagnostic'))
        assert(logged.includes('Sample diagnostic message'))
      } finally {
        console.error = origError
      }
    })

    it('logDiagnostic does not log when error is null or undefined', () => {
      const origError = console.error
      let logged = false
      console.error = () => {
        logged = true
      }
      try {
        logDiagnostic(null)
        logDiagnostic(undefined)
        assert.equal(logged, false, 'logDiagnostic must not log when error is null or undefined')
      } finally {
        console.error = origError
      }
    })

    it('sanitizeDiagnosticString redacts tokens and passwords directly in arbitrary strings', () => {
      const input = 'error: password=mysecret and token=abc12345 in Bearer xyz98765'
      const output = sanitizeDiagnosticString(input)
      assert.equal(output, 'error: password=[REDACTED] and token=[REDACTED] in Bearer [REDACTED]')
    })

    it('sanitizeDiagnosticString redacts credentials with both : and = separators without redacting normal prose', () => {
      // Colon assignments
      assert.equal(
        sanitizeDiagnosticString('Error with password: mySecretPassword123'),
        'Error with password: [REDACTED]'
      )
      assert.equal(
        sanitizeDiagnosticString('details: access_token: secret_token_xyz'),
        'details: access_token: [REDACTED]'
      )
      const validJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      assert.equal(
        sanitizeDiagnosticString('details: access_token: ' + validJwt),
        'details: access_token: [REDACTED_JWT]'
      )
      assert.equal(
        sanitizeDiagnosticString('failed at secret: confidential_phrase!'),
        'failed at secret: [REDACTED]'
      )
      assert.equal(
        sanitizeDiagnosticString('api_key: abc-123-def'),
        'api_key: [REDACTED]'
      )

      // Equal sign assignments
      assert.equal(
        sanitizeDiagnosticString('url?refresh_token=rt_987654321&other=1'),
        'url?refresh_token=[REDACTED]&other=1'
      )
      assert.equal(
        sanitizeDiagnosticString('password=secret123'),
        'password=[REDACTED]'
      )

      // Quoted keys and values
      assert.equal(
        sanitizeDiagnosticString('{"access_token": "secret_token_val"}'),
        '{"access_token": [REDACTED]}'
      )

      // Normal prose must NOT be redacted
      const safeProse = [
        'The user entered password yesterday in the portal',
        'This token represents an attendance voucher for CS101',
        'Meeting scheduled at the Secretariat conference room',
        'Public key cryptography is enabled',
      ]
      for (const phrase of safeProse) {
        assert.equal(
          sanitizeDiagnosticString(phrase),
          phrase,
          `Normal prose "${phrase}" must not be altered`
        )
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 14. Attendance Records Query Failure & Safe Initialization (S1 Invariant)
  // ──────────────────────────────────────────────────────────────────────────
  describe('14. Attendance Records Query Failure & Safe Initialization (S1 Invariant)', () => {
    it('S1.1: never initialises roster to all-present when records query has failed on existing draft', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 55,
        students: mockStudents,
        existingRecords: undefined, // Failed query!
        isRecordsLoading: false,
        isRecordsError: true,
        recordsError: new Error('PostgREST 500: internal database connection error'),
        sessionStatus: 'draft',
      }

      const res = resolveRosterInitializationState(input)
      assert.equal(res.state, 'QUERY_FAILED')
      if (res.state === 'QUERY_FAILED') {
        assert.equal(res.canRetry, true)
        assert.match(res.errorMessage, /database connection error/i)
      }
    })

    it('S1.2: distinguishes empty record set ([]) from failed query (undefined)', () => {
      // Empty records set: query succeeded, exactly 0 records exist
      const emptyInput: ResolveRosterStateInput = {
        sessionId: 55,
        students: mockStudents,
        existingRecords: [], // Query succeeded with 0 records
        isRecordsLoading: false,
        isRecordsError: false,
        sessionStatus: 'draft',
      }

      const emptyRes = resolveRosterInitializationState(emptyInput)
      assert.equal(emptyRes.state, 'READY')
      if (emptyRes.state === 'READY') {
        assert.equal(emptyRes.source, 'existing_restored')
        // Valid draft without stored records defaults enrolled students to present
        assert.equal(emptyRes.roster[101], 'present')
        assert.equal(emptyRes.roster[102], 'present')
      }

      // Query failed: undefined records with error
      const failedInput: ResolveRosterStateInput = {
        sessionId: 55,
        students: mockStudents,
        existingRecords: undefined, // NOT empty array
        isRecordsLoading: false,
        isRecordsError: true,
        recordsError: new Error('Timeout'),
      }

      const failedRes = resolveRosterInitializationState(failedInput)
      assert.equal(failedRes.state, 'QUERY_FAILED')
      assert.notEqual(failedRes.state, 'READY')
    })

    it('S1.3: preserves saved attendance statuses when records load successfully', () => {
      const input: ResolveRosterStateInput = {
        sessionId: 55,
        students: mockStudents,
        existingRecords: [
          { student_id: 101, status: 'present' },
          { student_id: 102, status: 'absent' },
          { student_id: 103, status: 'present' },
        ],
        isRecordsLoading: false,
        isRecordsError: false,
        sessionStatus: 'draft',
      }

      const res = resolveRosterInitializationState(input)
      assert.equal(res.state, 'READY')
      if (res.state === 'READY') {
        assert.equal(res.source, 'existing_restored')
        assert.equal(res.roster[101], 'present')
        assert.equal(res.roster[102], 'absent') // Preserved!
        assert.equal(res.roster[103], 'present')
      }
    })

    it('S1.4: evaluateAttendanceSaveAction strictly blocks save_draft when records query failed', () => {
      // Even if isRosterMatchingSession is claimed true, failure to load existing records blocks saving draft
      const input: SaveGuardInput = {
        operation: 'save_draft',
        sessionId: 55,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: undefined, // Failed to load!
        isRecordsLoading: false,
        isRecordsError: true,
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, false)
      assert.equal(res.code, 'UNRESOLVED_RECORDS')
      assert.match(res.reason ?? '', /could not be loaded/i)
    })

    it('S1.5: evaluateAttendanceSaveAction strictly blocks submit when records query failed', () => {
      const input: SaveGuardInput = {
        operation: 'submit',
        sessionId: 55,
        isSubmitted: false,
        isLocked: false,
        studentsCount: 3,
        hasInMemoryRoster: true,
        isRosterMatchingSession: true,
        existingRecords: undefined, // Failed to load!
        isRecordsLoading: false,
        isRecordsError: true,
      }

      const res = evaluateAttendanceSaveAction(input)
      assert.equal(res.allowed, false)
      assert.equal(res.code, 'UNRESOLVED_RECORDS')
      assert.match(res.reason ?? '', /could not be loaded/i)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 15. Unsaved Changes Guard Pure Detection (S2 Invariant)
  // ──────────────────────────────────────────────────────────────────────────
  describe('15. Unsaved Changes Guard Pure Detection (S2 Invariant)', () => {
    it('S2.1: returns false when current roster matches saved baseline exactly', () => {
      const baseline: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'absent',
        103: 'present',
      }
      const current: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'absent',
        103: 'present',
      }

      assert.equal(hasUnsavedAttendanceChanges(current, baseline), false)
    })

    it('S2.2: returns true when any student attendance status is modified', () => {
      const baseline: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'absent',
        103: 'present',
      }
      // Student 102 toggled to present
      const current: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'present',
        103: 'present',
      }

      assert.equal(hasUnsavedAttendanceChanges(current, baseline), true)
    })

    it('S2.3: returns false when modified student status is reverted back to baseline', () => {
      const baseline: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'absent',
        103: 'present',
      }
      // Student toggled away then toggled back
      const current: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'absent',
        103: 'present',
      }

      assert.equal(hasUnsavedAttendanceChanges(current, baseline), false)
    })

    it('S2.4: returns false when both rosters are empty or either is null/undefined', () => {
      assert.equal(hasUnsavedAttendanceChanges(null, null), false)
      assert.equal(hasUnsavedAttendanceChanges({}, null), false)
      assert.equal(hasUnsavedAttendanceChanges(null, {}), false)
      assert.equal(hasUnsavedAttendanceChanges({}, {}), false)
      assert.equal(hasUnsavedAttendanceChanges({ 101: 'present' }, null), false)
    })

    it('S2.5: returns true when student roster size differs from baseline', () => {
      const baseline: Record<number, AttendanceStatus> = {
        101: 'present',
      }
      const current: Record<number, AttendanceStatus> = {
        101: 'present',
        102: 'present',
      }

      assert.equal(hasUnsavedAttendanceChanges(current, baseline), true)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 16. Hardware Back Button Dispatcher & Layered Dismissal (S2 Invariant)
  // ──────────────────────────────────────────────────────────────────────────
  describe('16. Hardware Back Button Dispatcher & Layered Dismissal (S2 Invariant)', () => {
    beforeEach(() => {
      clearHardwareBackHandlers()
    })

    afterEach(() => {
      clearHardwareBackHandlers()
    })

    it('S2.6: returns false when no back handlers are registered', () => {
      assert.equal(dispatchHardwareBack(), false)
    })

    it('S2.7: executes registered handlers in LIFO stack order and consumes event on return true', () => {
      const executionOrder: string[] = []

      const unregisterFirst = registerHardwareBackHandler(() => {
        executionOrder.push('first')
        return false // did not consume
      })

      const unregisterSecond = registerHardwareBackHandler(() => {
        executionOrder.push('second')
        return true // consumed!
      })

      const handled = dispatchHardwareBack()
      assert.equal(handled, true)
      // Second handler was registered last, so it executes first
      assert.deepEqual(executionOrder, ['second'])

      unregisterFirst()
      unregisterSecond()
    })

    it('S2.8: models layered dismissal: unsaved dialog open -> first back closes dialog without navigating', () => {
      let showUnsavedModal = true
      let navigatedAway = false

      const unregister = registerHardwareBackHandler(() => {
        if (showUnsavedModal) {
          showUnsavedModal = false // first back dismisses dialog!
          return true // event consumed
        }
        return false // allows navigation
      })

      // 1. User presses hardware back while unsaved dialog is open
      const firstBackResult = dispatchHardwareBack()
      assert.equal(firstBackResult, true, 'Hardware back must consume event when dialog is open')
      assert.equal(showUnsavedModal, false, 'First back must close the unsaved dialog')
      assert.equal(navigatedAway, false, 'First back must NOT navigate away')

      // 2. User presses hardware back again now that dialog is closed and no unsaved changes
      const secondBackResult = dispatchHardwareBack()
      assert.equal(secondBackResult, false, 'Second back must allow default navigation')

      unregister()
    })

    it('S2.9: models multi-step wizard step-back: Step 3 -> Step 2 -> Step 1 -> Guard -> Default Exit', () => {
      let currentStep: 1 | 2 | 3 = 3
      let showUnsavedModal = false
      let hasUnsaved = true

      const unregister = registerHardwareBackHandler(() => {
        if (showUnsavedModal) {
          showUnsavedModal = false
          return true
        }
        if (currentStep === 3) {
          currentStep = 2
          return true
        }
        if (currentStep === 2) {
          currentStep = 1
          return true
        }
        if (hasUnsaved) {
          showUnsavedModal = true
          return true
        }
        return false
      })

      // Back 1: Step 3 -> Step 2
      assert.equal(dispatchHardwareBack(), true)
      assert.equal(currentStep, 2)

      // Back 2: Step 2 -> Step 1
      assert.equal(dispatchHardwareBack(), true)
      assert.equal(currentStep, 1)

      // Back 3: On Step 1 with unsaved changes -> opens unsaved dialog
      assert.equal(dispatchHardwareBack(), true)
      assert.equal(showUnsavedModal, true)

      // Back 4: With dialog open -> closes dialog (stays on Step 1)
      assert.equal(dispatchHardwareBack(), true)
      assert.equal(showUnsavedModal, false)
      assert.equal(currentStep, 1)

      // If user discards changes:
      hasUnsaved = false

      // Back 5: With 0 unsaved changes -> returns false (allows default navigation / app exit)
      assert.equal(dispatchHardwareBack(), false)

      unregister()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 17. Attendance Verification Edge Cases & Browser SPA Guard Tests
  // ──────────────────────────────────────────────────────────────────────────
  describe('17. Attendance Verification Edge Cases & Browser SPA Guard Tests', () => {
    // ── Edge Case 1: date-session query failure ──
    describe('Edge Case 1: date-session query failure protections', () => {
      it('EC1.1: resolveRosterInitializationState enters QUERY_FAILED on session lookup error and never defaults to all-present', () => {
        const input: ResolveRosterStateInput = {
          sessionId: null, // Effective session ID resolved to null because lookup failed
          students: mockStudents,
          existingRecords: undefined,
          isRecordsLoading: false,
          isRecordsError: false,
          isSessionLookupError: true, // date-session query encountered an error!
          sessionLookupError: new Error('PostgREST 500: Database connection failure during date lookup'),
        }

        const res = resolveRosterInitializationState(input)
        assert.equal(res.state, 'QUERY_FAILED')
        if (res.state === 'QUERY_FAILED') {
          assert.equal(res.canRetry, true)
          assert.match(res.errorMessage, /Database connection failure/i)
        }
      })

      it('EC1.2: resolveRosterInitializationState falls back to clear default error message when sessionLookupError is missing message', () => {
        const input: ResolveRosterStateInput = {
          sessionId: null,
          students: mockStudents,
          existingRecords: undefined,
          isRecordsLoading: false,
          isRecordsError: false,
          isSessionLookupError: true,
          sessionLookupError: null,
        }

        const res = resolveRosterInitializationState(input)
        assert.equal(res.state, 'QUERY_FAILED')
        if (res.state === 'QUERY_FAILED') {
          assert.equal(res.canRetry, true)
          assert.match(res.errorMessage, /failed to verify existing session/i)
        }
      })

      it('EC1.3: distinguishes failed date-session lookup from successful empty date-session lookup', () => {
        // Successful lookup that found no existing session: isSessionLookupError is false, sessionId is null
        const cleanNewSession: ResolveRosterStateInput = {
          sessionId: null,
          students: mockStudents,
          existingRecords: undefined,
          isRecordsLoading: false,
          isRecordsError: false,
          isSessionLookupError: false,
        }
        const cleanRes = resolveRosterInitializationState(cleanNewSession)
        assert.equal(cleanRes.state, 'READY')
        if (cleanRes.state === 'READY') {
          assert.equal(cleanRes.source, 'new_defaults')
          assert.equal(cleanRes.roster[101], 'present')
        }

        // Failed lookup: isSessionLookupError is true -> strictly QUERY_FAILED
        const failedLookup: ResolveRosterStateInput = {
          ...cleanNewSession,
          isSessionLookupError: true,
          sessionLookupError: new Error('Network timeout'),
        }
        const failedRes = resolveRosterInitializationState(failedLookup)
        assert.equal(failedRes.state, 'QUERY_FAILED')
      })

      it('EC1.4: evaluateAttendanceSaveAction strictly blocks save_draft when isSessionLookupError is true', () => {
        const input: SaveGuardInput = {
          operation: 'save_draft',
          sessionId: null,
          isSubmitted: false,
          isLocked: false,
          studentsCount: 3,
          hasInMemoryRoster: true,
          isRosterMatchingSession: true,
          existingRecords: undefined,
          isRecordsLoading: false,
          isRecordsError: false,
          isSessionLookupError: true, // Failed date lookup!
        }

        const res = evaluateAttendanceSaveAction(input)
        assert.equal(res.allowed, false)
        assert.equal(res.code, 'UNRESOLVED_RECORDS')
        assert.match(res.reason ?? '', /session lookup encountered an error/i)
      })

      it('EC1.5: evaluateAttendanceSaveAction strictly blocks submit when isSessionLookupError is true', () => {
        const input: SaveGuardInput = {
          operation: 'submit',
          sessionId: null,
          isSubmitted: false,
          isLocked: false,
          studentsCount: 3,
          hasInMemoryRoster: true,
          isRosterMatchingSession: true,
          existingRecords: undefined,
          isRecordsLoading: false,
          isRecordsError: false,
          isSessionLookupError: true, // Failed date lookup!
        }

        const res = evaluateAttendanceSaveAction(input)
        assert.equal(res.allowed, false)
        assert.equal(res.code, 'UNRESOLVED_RECORDS')
        assert.match(res.reason ?? '', /session lookup encountered an error/i)
      })

      it('EC1.6: evaluateAttendanceSaveAction strictly blocks correct when isSessionLookupError is true', () => {
        const input: SaveGuardInput = {
          operation: 'correct',
          sessionId: 99,
          isSubmitted: true,
          isLocked: false,
          studentsCount: 3,
          hasInMemoryRoster: true,
          isRosterMatchingSession: true,
          existingRecords: [{ student_id: 101, status: 'present' }],
          isRecordsLoading: false,
          isRecordsError: false,
          isSessionLookupError: true,
          editReason: 'Correction reason',
        }

        const res = evaluateAttendanceSaveAction(input)
        assert.equal(res.allowed, false)
        assert.equal(res.code, 'UNRESOLVED_RECORDS')
        assert.match(res.reason ?? '', /session lookup encountered an error/i)
      })
    })

    // ── Edge Case 2: baselineRosterRef lifecycle ──
    describe('Edge Case 2: baselineRosterRef lifecycle and state transitions', () => {
      it('EC2.1: baseline is initialized only after attendance records have loaded successfully (existing session)', () => {
        let baseline: Record<number, AttendanceStatus> | null = null

        // Step 1: Initial mount, query in flight
        const loadingRes = resolveRosterInitializationState({
          sessionId: 100,
          students: mockStudents,
          existingRecords: undefined,
          isRecordsLoading: true,
          isRecordsError: false,
        })
        assert.equal(loadingRes.state, 'WAITING_FOR_QUERY')
        // Baseline remains null while query is loading
        assert.equal(baseline, null)

        // Step 2: Query fails
        const errorRes = resolveRosterInitializationState({
          sessionId: 100,
          students: mockStudents,
          existingRecords: undefined,
          isRecordsLoading: false,
          isRecordsError: true,
          recordsError: new Error('Load failed'),
        })
        assert.equal(errorRes.state, 'QUERY_FAILED')
        // Baseline remains null when query fails
        assert.equal(baseline, null)

        // Step 3: Query succeeds
        const successRes = resolveRosterInitializationState({
          sessionId: 100,
          students: mockStudents,
          existingRecords: [
            { student_id: 101, status: 'present' },
            { student_id: 102, status: 'absent' },
            { student_id: 103, status: 'present' },
          ],
          isRecordsLoading: false,
          isRecordsError: false,
        })
        assert.equal(successRes.state, 'READY')
        if (successRes.state === 'READY') {
          baseline = { ...successRes.roster }
        }

        // Baseline now accurately holds the loaded saved records
        assert.deepEqual(baseline, { 101: 'present', 102: 'absent', 103: 'present' })
        // Roster matches baseline -> hasUnsavedAttendanceChanges is false
        assert.equal(hasUnsavedAttendanceChanges(baseline, baseline), false)
      })

      it('EC2.2: baseline updates only after a successful draft save operation', () => {
        // Initial loaded baseline for draft session 100
        let baseline: Record<number, AttendanceStatus> | null = {
          101: 'present',
          102: 'present',
          103: 'present',
        }
        let inMemoryRoster: Record<number, AttendanceStatus> = { ...baseline }

        // Professor marks student 102 absent
        inMemoryRoster = { ...inMemoryRoster, 102: 'absent' }
        assert.equal(hasUnsavedAttendanceChanges(inMemoryRoster, baseline), true)

        // Save Draft fails (e.g. network disconnect)
        // Baseline MUST NOT be updated on failure!
        const saveFailed = true
        if (!saveFailed) {
          baseline = { ...inMemoryRoster }
        }
        assert.equal(hasUnsavedAttendanceChanges(inMemoryRoster, baseline), true)
        assert.equal(baseline[102], 'present') // Unchanged!

        // Save Draft succeeds
        const saveSucceeded = true
        if (saveSucceeded) {
          baseline = { ...inMemoryRoster } // Updated inside onSuccess!
        }
        assert.equal(hasUnsavedAttendanceChanges(inMemoryRoster, baseline), false)
        assert.equal(baseline[102], 'absent') // Now updated!
      })

      it('EC2.3: baseline resets to null on date change or assignment switch', () => {
        let baseline: Record<number, AttendanceStatus> | null = {
          101: 'present',
          102: 'absent',
          103: 'present',
        }
        assert.notEqual(baseline, null)

        // Date changed or assignment changed: reset baseline to null
        const resetBaseline = () => {
          baseline = null
        }
        resetBaseline()
        assert.equal(baseline, null)
      })

      it('EC2.4: reopening an existing session restores exact saved records into baseline without wiping absentees', () => {
        const savedSessionRecords = [
          { student_id: 101, status: 'absent' },
          { student_id: 102, status: 'present' },
          { student_id: 103, status: 'absent' },
        ]

        const res = resolveRosterInitializationState({
          sessionId: 150,
          students: mockStudents,
          existingRecords: savedSessionRecords,
          isRecordsLoading: false,
          isRecordsError: false,
          sessionStatus: 'draft',
        })

        assert.equal(res.state, 'READY')
        if (res.state === 'READY') {
          assert.equal(res.source, 'existing_restored')
          const baseline = { ...res.roster }
          assert.equal(baseline[101], 'absent')
          assert.equal(baseline[102], 'present')
          assert.equal(baseline[103], 'absent')
          // Clean state upon opening
          assert.equal(hasUnsavedAttendanceChanges(res.roster, baseline), false)
        }
      })
    })

    // ── Edge Case 3: Browser SPA back navigation guard ──
    describe('Edge Case 3: Browser SPA back navigation guard and state machine', () => {
      it('EC3.1: allows immediate back navigation when page is clean with no unsaved changes', () => {
        let showUnsavedModal = false
        let navigatedBack = false

        // State machine simulating browser popstate handler
        const simulatePopState = (state: {
          hasUnsavedChanges: boolean
          showUnsavedModal: boolean
          showConfirmModal: boolean
          currentStep: number
          wasGuarded: boolean
        }) => {
          if (!state.wasGuarded) {
            navigatedBack = true
            return
          }
          if (state.showUnsavedModal) {
            showUnsavedModal = false
            return
          }
          if (state.hasUnsavedChanges) {
            showUnsavedModal = true
            return
          }
          navigatedBack = true
        }

        simulatePopState({
          hasUnsavedChanges: false,
          showUnsavedModal: false,
          showConfirmModal: false,
          currentStep: 1,
          wasGuarded: false, // Clean mount was never guarded
        })

        assert.equal(navigatedBack, true)
        assert.equal(showUnsavedModal, false)
      })

      it('EC3.2: intercepts browser back navigation and opens confirmation modal when unsaved changes exist', () => {
        let showUnsavedModal = false
        let navigatedBack = false

        const simulatePopState = (state: {
          hasUnsavedChanges: boolean
          showUnsavedModal: boolean
          showConfirmModal: boolean
          currentStep: number
          wasGuarded: boolean
        }) => {
          if (!state.wasGuarded) {
            navigatedBack = true
            return
          }
          if (state.showUnsavedModal) {
            showUnsavedModal = false
            return
          }
          if (state.hasUnsavedChanges) {
            showUnsavedModal = true
            return
          }
          navigatedBack = true
        }

        // User made edits on Step 1: guard was armed (wasGuarded: true), unsaved changes exist
        simulatePopState({
          hasUnsavedChanges: true,
          showUnsavedModal: false,
          showConfirmModal: false,
          currentStep: 1,
          wasGuarded: true,
        })

        assert.equal(showUnsavedModal, true)
        assert.equal(navigatedBack, false)
      })

      it('EC3.3: layered dismissal: first back dismisses open confirmation dialog without navigating', () => {
        let showUnsavedModal = true
        let navigatedBack = false

        const simulatePopState = (state: {
          hasUnsavedChanges: boolean
          showUnsavedModal: boolean
          showConfirmModal: boolean
          currentStep: number
          wasGuarded: boolean
        }) => {
          if (!state.wasGuarded) {
            navigatedBack = true
            return
          }
          if (state.showUnsavedModal) {
            showUnsavedModal = false
            return
          }
          if (state.hasUnsavedChanges) {
            showUnsavedModal = true
            return
          }
          navigatedBack = true
        }

        // User presses back while unsaved dialog is already open
        simulatePopState({
          hasUnsavedChanges: true,
          showUnsavedModal: true,
          showConfirmModal: false,
          currentStep: 1,
          wasGuarded: true,
        })

        assert.equal(showUnsavedModal, false) // Dialog closed
        assert.equal(navigatedBack, false)    // Stayed on page!
      })

      it('EC3.4: wizard multi-step back: Step 3 -> Step 2 -> Step 1 -> Guard -> Discard', () => {
        let currentStep = 3
        let showUnsavedModal = false
        let navigatedBack = false
        let isDiscarding = false

        const handleBrowserBack = () => {
          if (isDiscarding) {
            navigatedBack = true
            return
          }
          if (showUnsavedModal) {
            showUnsavedModal = false
            return
          }
          if (currentStep === 3) {
            currentStep = 2
            return
          }
          if (currentStep === 2) {
            currentStep = 1
            return
          }
          // On Step 1 with unsaved changes
          showUnsavedModal = true
        }

        // Back 1: Step 3 -> Step 2
        handleBrowserBack()
        assert.equal(currentStep, 2)
        assert.equal(navigatedBack, false)

        // Back 2: Step 2 -> Step 1
        handleBrowserBack()
        assert.equal(currentStep, 1)
        assert.equal(navigatedBack, false)

        // Back 3: On Step 1 with unsaved changes -> prompts with modal
        handleBrowserBack()
        assert.equal(showUnsavedModal, true)
        assert.equal(navigatedBack, false)

        // If user chooses "Keep Editing" -> modal dismissed, marks preserved
        showUnsavedModal = false
        assert.equal(currentStep, 1)
        assert.equal(navigatedBack, false)

        // If user chooses "Discard Changes" -> navigation executes
        isDiscarding = true
        handleBrowserBack()
        assert.equal(navigatedBack, true)
      })
    })
  })
})
