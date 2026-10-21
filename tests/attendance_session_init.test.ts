import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveRosterInitializationState,
  evaluateAttendanceSaveAction,
  AttendanceGuardError,
  type ResolveRosterStateInput,
  type SaveGuardInput,
} from '../src/lib/attendanceSessionInit.ts'
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
  })
})
