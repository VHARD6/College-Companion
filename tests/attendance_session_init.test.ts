import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveRosterInitializationState,
  type ResolveRosterStateInput,
} from '../src/lib/attendanceSessionInit.ts'
import type { AttendanceStatus } from '../src/types'

describe('Attendance Session Initialization & Query Safety Test Suite (Pass 1a)', () => {
  const mockStudents = [
    { id: 101, roll_no: 'CS01' },
    { id: 102, roll_no: 'CS02' },
    { id: 103, roll_no: 'CS03' },
  ]

  // ──────────────────────────────────────────────────────────────────────────
  // 1. New session (no sessionId)
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
  // 2. Query failure and error prevention (S1 invariant)
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
  // 3. Submitted / locked session
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
  // 4. Existing session with zero records
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
  // 5. Partial records (students missing from saved records)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Partial records: students missing from saved records', () => {
    it('restores status for recorded students and safely defaults missing students to present', () => {
      // Student 102 was explicitly marked absent; student 103 was marked present; student 101 has no record
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
        // Preserves saved absent for student 102
        assert.equal(result.roster[102], 'absent')
        // Preserves saved present for student 103
        assert.equal(result.roster[103], 'present')
        // Missing student 101 defaults to present in accordance with existing app policy
        assert.equal(result.roster[101], 'present')
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Failure then successful retry flow
  // ──────────────────────────────────────────────────────────────────────────
  describe('Failure then successful retry flow', () => {
    it('handles transition from error -> retry loading -> success cleanly', () => {
      // Step 1: Query fails
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

      // Step 2: User taps Retry -> query starts loading
      const retryLoadingInput: ResolveRosterStateInput = {
        sessionId: 70,
        students: mockStudents,
        existingRecords: undefined,
        isRecordsLoading: true,
        isRecordsError: false,
      }
      const retryLoadingResult = resolveRosterInitializationState(retryLoadingInput)
      assert.equal(retryLoadingResult.state, 'WAITING_FOR_QUERY')

      // Step 3: Query succeeds on retry with saved absentees
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
  // 7. In-memory roster preservation
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
})
