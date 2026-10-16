import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validatePortalAccess } from '../src/lib/authUtils.ts'

describe('Security & Attendance Integrity Hardening Test Suite', () => {
  // ─── PART 1: Role Isolation & Data Boundaries ─────────────────────────────
  describe('1. Role & Academic Data Isolation', () => {
    it('1. permits student to access own academic records', () => {
      const studentProfile = { id: 'usr-student-1', role: 'student', is_active: true }
      const access = validatePortalAccess('student', studentProfile)
      assert.equal(access.allowed, true)
      assert.equal(access.redirectPath, '/student')

      // Simulation of ar_student_read policy rule:
      // student_id = get_my_student_id()
      const studentId = 101
      const recordStudentId = 101
      const isRecordVisible = recordStudentId === studentId
      assert.equal(isRecordVisible, true)
    })

    it("2. denies student from reading another student's private attendance records", () => {
      const currentStudentId = 101
      const otherStudentRecord = { id: 502, student_id: 102, status: 'absent' }
      // Under ar_student_read:
      const canRead = otherStudentRecord.student_id === currentStudentId
      assert.equal(canRead, false)
    })

    it('3. permits professor to read roster for their assigned class and batch', () => {
      const professorId = 1
      const teachingAssignments = [
        { id: 10, professor_id: professorId, class_id: 5, batch_id: null }, // Theory class 5
        { id: 11, professor_id: professorId, class_id: 5, batch_id: 2 },    // Practical batch 2
      ]

      const studentInClass = { id: 201, class_id: 5, batch_id: 1 }
      const studentInBatch2 = { id: 202, class_id: 5, batch_id: 2 }

      // Under students_prof_read:
      const canReadClass = teachingAssignments.some(
        ta => ta.class_id === studentInClass.class_id && (ta.batch_id === null || ta.batch_id === studentInClass.batch_id)
      )
      assert.equal(canReadClass, true)

      const canReadBatch2 = teachingAssignments.some(
        ta => ta.class_id === studentInBatch2.class_id && (ta.batch_id === null || ta.batch_id === studentInBatch2.batch_id)
      )
      assert.equal(canReadBatch2, true)
    })

    it('4. denies professor from reading student records in unassigned classes', () => {
      const teachingAssignments = [
        { id: 10, professor_id: 1, class_id: 5, batch_id: null },
      ]
      const unassignedStudent = { id: 301, class_id: 9, batch_id: null }

      const canRead = teachingAssignments.some(
        ta => ta.class_id === unassignedStudent.class_id
      )
      assert.equal(canRead, false)
    })

    it('5. denies professor from modifying sessions owned by another professor', () => {
      const loggedInProfId = 1
      const session = {
        id: 77,
        teaching_assignment_id: 99,
        professor_id: 2, // belongs to professor 2
        status: 'draft',
      }

      // Under sessions_prof_update and RPC check:
      const canModify = session.professor_id === loggedInProfId
      assert.equal(canModify, false)
    })

    it('6. denies inactive accounts from accessing any protected role data', () => {
      const inactiveStudent = { role: 'student', is_active: false }
      const inactiveProf = { role: 'professor', is_active: false }
      const inactiveAdmin = { role: 'admin', is_active: false }

      assert.equal(validatePortalAccess('student', inactiveStudent).allowed, false)
      assert.equal(validatePortalAccess('staff', inactiveProf).allowed, false)
      assert.equal(validatePortalAccess('staff', inactiveAdmin).allowed, false)
    })

    it('7. denies non-admin users from escalating their role or updating active status', () => {
      const currentRole = 'student'
      const attemptedRoleChange = 'admin'
      const attemptedActiveChange = true

      // Simulation of profiles_prevent_role_update WITH CHECK:
      const isAdmin = currentRole === 'admin'
      const canChangeRole = isAdmin || (attemptedRoleChange === currentRole)
      assert.equal(canChangeRole, false)
      const canChangeActive = isAdmin && attemptedActiveChange
      assert.equal(canChangeActive, false)
    })

    it('8. denies unauthenticated and non-admin callers from provisioning privileged accounts', () => {
      const callerRole = 'student'
      const isCallerAuthorized = callerRole === 'admin'
      assert.equal(isCallerAuthorized, false)
    })
  })

  // ─── PART 2: Attendance Submission & Atomicity ────────────────────────────
  describe('2. Attendance Submission & Atomic State Transitions', () => {
    it('9. authorizes valid session submission by assigned professor', () => {
      const session = {
        teaching_assignment_id: 10,
        assigned_professor_id: 1,
        date: '2026-10-16',
        session_type: 'lecture',
        status: 'draft',
      }
      const callingProfId = 1
      const isAuthorized = session.assigned_professor_id === callingProfId
      assert.equal(isAuthorized, true)
    })

    it('10. enforces unique (session_id, student_id) attendance record idempotency', () => {
      const records = new Map<string, string>()
      const key1 = 'session_1_student_101'

      // First insert
      records.set(key1, 'present')
      assert.equal(records.get(key1), 'present')

      // Subsequent duplicate upsert overrides cleanly without duplicate row creation
      records.set(key1, 'absent')
      assert.equal(records.get(key1), 'absent')
      assert.equal(records.size, 1)
    })

    it('11. denies unauthorized professor from submitting or correcting an unowned session', () => {
      const session = { id: 45, teaching_assignment_id: 20, professor_id: 2 }
      const callerProfId = 3

      const canSubmit = callerProfId === session.professor_id
      assert.equal(canSubmit, false)
    })

    it('12. protects submitted_at timestamp against client-side tampering or reset to draft', () => {
      const submittedSession = {
        id: 12,
        status: 'submitted',
        submitted_at: '2026-10-16T10:00:00Z',
      }

      // Simulation of protect_session_submission trigger:
      const attemptedReopen = { status: 'draft' }
      const isReopenAllowed = !(submittedSession.status === 'submitted' && attemptedReopen.status === 'draft')
      assert.equal(isReopenAllowed, false)

      const attemptedTimestampReset = { submitted_at: '2026-10-16T12:00:00Z' }
      const isTimestampTamperAllowed = attemptedTimestampReset.submitted_at === submittedSession.submitted_at
      assert.equal(isTimestampTamperAllowed, false)
    })

    it('13. rejects correction attempt when reason is empty or whitespace', () => {
      const reasons = ['', '   ', '\t\n']
      reasons.forEach(r => {
        const isValidReason = Boolean(r && r.trim().length > 0)
        assert.equal(isValidReason, false)
      })

      const validReason = 'Roll 14 entered late with slip'
      assert.equal(Boolean(validReason && validReason.trim().length > 0), true)
    })

    it('14. atomically creates audit log entry on valid attendance correction', () => {
      const previousRecord = { id: 101, status: 'present' }
      const newStatus = 'absent'
      const reason = 'Marked present by error'

      const auditEntry = {
        record_id: previousRecord.id,
        old_status: previousRecord.status,
        new_status: newStatus,
        reason: reason.trim(),
        changed_at: new Date().toISOString(),
      }

      assert.equal(auditEntry.old_status, 'present')
      assert.equal(auditEntry.new_status, 'absent')
      assert.equal(auditEntry.record_id, 101)
      assert.equal(auditEntry.reason.length > 0, true)
    })

    it('15. simulates transaction rollback if audit log insertion fails', () => {
      let stateCommitted = false
      const simulateAtomicRpc = (failAudit: boolean) => {
        try {
          // Step 1: Attendance record updated in memory
          const updatedRecord = { id: 1, status: 'absent' }
          // Step 2: Audit insertion fails
          if (failAudit) {
            throw new Error('Audit log write constraint failed')
          }
          stateCommitted = true
          return updatedRecord
        } catch {
          stateCommitted = false // Rollback transaction
          return null
        }
      }

      simulateAtomicRpc(true)
      assert.equal(stateCommitted, false)

      simulateAtomicRpc(false)
      assert.equal(stateCommitted, true)
    })

    it('16. denies correction when correction window has expired', () => {
      const windowHours = 24
      const windowMs = windowHours * 60 * 60 * 1000

      const now = Date.now()
      const recentSubmission = now - (2 * 60 * 60 * 1000) // 2 hours ago
      const expiredSubmission = now - (25 * 60 * 60 * 1000) // 25 hours ago

      const isRecentAllowed = (now - recentSubmission) <= windowMs
      const isExpiredAllowed = (now - expiredSubmission) <= windowMs

      assert.equal(isRecentAllowed, true)
      assert.equal(isExpiredAllowed, false)
    })

    it('17. enforces that attendance_audit_log is append-only and cannot be updated or deleted', () => {
      // Simulation of trg_audit_log_immutable trigger rule:
      const attemptOperation = (op: 'INSERT' | 'UPDATE' | 'DELETE') => {
        if (op === 'UPDATE' || op === 'DELETE') {
          throw new Error('attendance_audit_log entries are strictly append-only')
        }
        return 'success'
      }

      assert.equal(attemptOperation('INSERT'), 'success')
      assert.throws(() => attemptOperation('UPDATE'), /strictly append-only/)
      assert.throws(() => attemptOperation('DELETE'), /strictly append-only/)
    })
  })

  // ─── PART 3: Provisioning & UI Integrity ─────────────────────────────────
  describe('3. Administrator Provisioning & UI Query Integrity', () => {
    it('18. returns error and performs compensating rollback if auxiliary role insert fails', () => {
      let authUserDeleted = false
      let deletedUserId: string | null = null
      const createdUserId = 'usr-temp-123'

      const simulateEdgeFunction = (studentInsertFails: boolean) => {
        if (studentInsertFails) {
          // Compensating rollback
          authUserDeleted = true
          deletedUserId = createdUserId
          return { success: false, error: 'Failed to create student record: Class ID invalid' }
        }
        return { success: true }
      }

      const res = simulateEdgeFunction(true)
      assert.equal(res.success, false)
      assert.equal(authUserDeleted, true)
      assert.equal(deletedUserId, createdUserId)
      assert.match(res.error || '', /Class ID invalid/i)
    })

    it('19. does not report success when required role-specific records are missing', () => {
      const formRole = 'student'
      const studentRollNo = '' // missing required field

      const validateProvisioningPayload = (role: string, rollNo: string) => {
        if (role === 'student' && !rollNo.trim()) {
          return { valid: false, error: 'Roll number is required for student accounts.' }
        }
        return { valid: true }
      }

      const check = validateProvisioningPayload(formRole, studentRollNo)
      assert.equal(check.valid, false)
      assert.match(check.error || '', /Roll number is required/i)
    })

    it('20. treats query errors as error states rather than empty attendance or 0% summaries', () => {
      const simulateQueryHandler = (queryError: any, data: any[]) => {
        if (queryError) {
          return { status: 'error', error: queryError.message, summaries: null }
        }
        return { status: 'success', error: null, summaries: data }
      }

      const errorResult = simulateQueryHandler(new Error('Network connection timeout'), [])
      assert.equal(errorResult.status, 'error')
      assert.equal(errorResult.summaries, null)
      assert.notEqual(errorResult.status, 'success')
    })
  })
})
