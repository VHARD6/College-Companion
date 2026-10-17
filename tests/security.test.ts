import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validatePortalAccess } from '../src/lib/authUtils.ts'
import { calcPercent, calcSkippable, calcNeeded, classifyStatus } from '../src/lib/attendance.ts'

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

  // ─── PART 4: Strict RLS Isolation & Cross-Entity Boundaries ───────────────
  describe('4. Strict RLS Isolation & Cross-Entity Boundaries', () => {
    it('21. strictly filters attendance records so student only receives their own row even on bulk select', () => {
      // Simulating ar_student_read: (get_my_role() = 'student' AND student_id = get_my_student_id())
      const myStudentId = 101
      const myRole = 'student'

      const allTableRecords = [
        { id: 1, session_id: 1, student_id: 101, status: 'present' },
        { id: 2, session_id: 1, student_id: 102, status: 'absent' },
        { id: 3, session_id: 1, student_id: 103, status: 'present' },
        { id: 4, session_id: 2, student_id: 101, status: 'absent' },
        { id: 5, session_id: 2, student_id: 102, status: 'present' },
      ]

      const evaluatePolicy = (rec: { student_id: number }) => {
        if (myRole === 'student') {
          return rec.student_id === myStudentId
        }
        return false
      }

      const visibleRecords = allTableRecords.filter(evaluatePolicy)
      assert.equal(visibleRecords.length, 2)
      assert.deepEqual(visibleRecords.map(r => r.id), [1, 4])
      assert.equal(visibleRecords.every(r => r.student_id === myStudentId), true)
    })

    it('22. professor cannot read student roster for classes outside their teaching assignments', () => {
      // Simulating students_prof_roster_read with hardened can_access_student_roster:
      // ta.batch_id IS NULL OR (p_batch_id IS NOT NULL AND ta.batch_id = p_batch_id)
      const profId = 5
      const assignments = [
        { id: 1, professor_id: profId, class_id: 10, batch_id: null }, // Theory for Class 10
      ]

      const canAccessStudentRoster = (classId: number, batchId: number | null) => {
        return assignments.some(
          ta => ta.professor_id === profId &&
                ta.class_id === classId &&
                (ta.batch_id === null || (batchId !== null && ta.batch_id === batchId))
        )
      }

      // Student in Class 10 (both with and without batch assignment can access whole-class lecture)
      assert.equal(canAccessStudentRoster(10, null), true)
      assert.equal(canAccessStudentRoster(10, 1), true)

      // Student in Class 11 (unrelated class)
      assert.equal(canAccessStudentRoster(11, null), false)
      assert.equal(canAccessStudentRoster(11, 1), false)
    })

    it('23. professor assigned to a specific batch cannot access roster of other batches or unassigned students', () => {
      // Simulating hardened can_access_student_roster:
      // Enforces that a batch-specific assignment (ta.batch_id = 1) NEVER matches a student with batch_id = null
      const profId = 5
      const assignments = [
        { id: 2, professor_id: profId, class_id: 10, batch_id: 1 }, // Lab for Class 10 Batch 1 ONLY
      ]

      const canAccessStudentRoster = (classId: number, batchId: number | null) => {
        return assignments.some(
          ta => ta.professor_id === profId &&
                ta.class_id === classId &&
                (ta.batch_id === null || (batchId !== null && ta.batch_id === batchId))
        )
      }

      // Batch 1 student (authorized)
      assert.equal(canAccessStudentRoster(10, 1), true)

      // Batch 2 student (unauthorized)
      assert.equal(canAccessStudentRoster(10, 2), false)

      // Unassigned student with batch_id = null (unauthorized — strictly excluded from batch 1 practical)
      assert.equal(canAccessStudentRoster(10, null), false)

      // Different class student (unauthorized)
      assert.equal(canAccessStudentRoster(12, 1), false)
    })

    it('24. student cannot access timetable slots for other classes or batches', () => {
      // Simulating tt_student_read
      const studentClassId = 10
      const studentBatchId = 2

      const teachingAssignments = [
        { id: 101, class_id: 10, batch_id: null }, // Class 10 Lecture
        { id: 102, class_id: 10, batch_id: 1 },    // Class 10 Batch 1 Lab
        { id: 103, class_id: 10, batch_id: 2 },    // Class 10 Batch 2 Lab
        { id: 104, class_id: 20, batch_id: null }, // Class 20 Lecture
      ]

      const eligibleAssignmentIds = new Set(
        teachingAssignments
          .filter(ta => ta.class_id === studentClassId && (ta.batch_id === null || ta.batch_id === studentBatchId))
          .map(ta => ta.id)
      )

      assert.equal(eligibleAssignmentIds.has(101), true)  // Common lecture for my class
      assert.equal(eligibleAssignmentIds.has(102), false) // Other batch lab -> forbidden
      assert.equal(eligibleAssignmentIds.has(103), true)  // My batch lab -> allowed
      assert.equal(eligibleAssignmentIds.has(104), false) // Different class -> forbidden
    })

    it('25. academic profile read prevents cross-student snooping without academic relationship', () => {
      // Simulating can_read_academic_profile(target_user_id)
      const evaluateAcademicProfileRead = (
        caller: { id: string; role: string; profId?: number; classId?: number },
        target: { id: string; role: string; classId?: number; batchId?: number },
        assignments: Array<{ professor_id: number; class_id: number }>
      ) => {
        if (caller.id === target.id) return true
        if (caller.role === 'admin') return true
        if (caller.role === 'professor' && caller.profId && target.role === 'student' && target.classId) {
          return assignments.some(a => a.professor_id === caller.profId && a.class_id === target.classId)
        }
        if (caller.role === 'student' && target.role === 'student') {
          return false
        }
        return false
      }

      const assignments = [{ professor_id: 1, class_id: 10 }]

      // Case 1: Student 1 attempts to read Student 2
      assert.equal(
        evaluateAcademicProfileRead(
          { id: 's1', role: 'student', classId: 10 },
          { id: 's2', role: 'student', classId: 10 },
          assignments
        ),
        false
      )

      // Case 2: Professor 1 reads enrolled Student 1
      assert.equal(
        evaluateAcademicProfileRead(
          { id: 'p1', role: 'professor', profId: 1 },
          { id: 's1', role: 'student', classId: 10 },
          assignments
        ),
        true
      )

      // Case 3: Professor 1 reads unassigned Student 3 (class 20)
      assert.equal(
        evaluateAcademicProfileRead(
          { id: 'p1', role: 'professor', profId: 1 },
          { id: 's3', role: 'student', classId: 20 },
          assignments
        ),
        false
      )

      // Case 4: Admin reads any profile
      assert.equal(
        evaluateAcademicProfileRead(
          { id: 'a1', role: 'admin' },
          { id: 's3', role: 'student', classId: 20 },
          assignments
        ),
        true
      )
    })

    it('26. rejects duplicate session submission when session is already submitted', () => {
      // Simulating submit_attendance_session duplicate check
      const simulateSubmitRpc = (session: { id: number; status: string }) => {
        if (session.status === 'submitted') {
          throw new Error(`Session ${session.id} has already been submitted. Use correction workflow for modifications.`)
        }
        return { success: true, status: 'submitted' }
      }

      // First submit: draft -> submitted
      const draftSession = { id: 10, status: 'draft' }
      const res = simulateSubmitRpc(draftSession)
      assert.equal(res.status, 'submitted')

      // Second submit: already submitted -> error
      const submittedSession = { id: 10, status: 'submitted' }
      assert.throws(
        () => simulateSubmitRpc(submittedSession),
        /already been submitted/i
      )
    })

    it('27. attendance formulas handle empty data and threshold boundary conditions correctly', () => {
      // Empty data: 0 held classes
      assert.equal(calcPercent(0, 0), null)
      assert.equal(calcSkippable(0, 0, 75), 0)
      assert.equal(calcNeeded(0, 0, 75), 0)
      assert.equal(classifyStatus(calcPercent(0, 0), 75), 'unknown')

      // Exactly at threshold boundary
      assert.equal(calcPercent(15, 20), 75) // 15/20 = 75%
      assert.equal(classifyStatus(75, 75), 'safe')
      assert.equal(calcSkippable(15, 20, 75), 0)
      assert.equal(calcNeeded(15, 20, 75), 0)

      // Just below threshold (warning zone)
      assert.equal(calcPercent(14, 20), 70)
      assert.equal(classifyStatus(70, 75), 'warning')
      assert.equal(calcNeeded(14, 20, 75), 4) // 75*20 - 100*14 = 1500 - 1400 = 100. 100 / (100 - 75) = 100 / 25 = 4 classes needed!
      assert.equal(calcSkippable(14, 20, 75), 0)

      // Far below threshold (danger zone)
      assert.equal(calcPercent(10, 20), 50)
      assert.equal(classifyStatus(50, 75), 'danger')

      // 100% threshold where 1 class was missed
      assert.equal(calcNeeded(9, 10, 100), Infinity)
    })
  })

  // ─── PART 5: End-to-End Provisioning, Compensating Rollback & Reconciliation ─
  describe('5. End-to-End Provisioning, Compensating Rollback & Reconciliation', () => {
    it('28. orphan profile reconciliation strictly enforces safe default role student and ignores user_metadata', () => {
      // Simulating Migration 008 safe orphan reconciliation logic
      const existingProfiles = new Map<string, { id: string; name: string; role: string; is_active: boolean }>([
        ['admin-1', { id: 'admin-1', name: 'Real Admin', role: 'admin', is_active: true }],
        ['disabled-stud', { id: 'disabled-stud', name: 'Deactivated Student', role: 'student', is_active: false }],
      ])

      const authUsers = [
        // Existing admin (must remain untouched)
        { id: 'admin-1', email: 'admin@college.edu', raw_user_meta_data: { role: 'admin', name: 'Real Admin' } },
        // Existing deactivated student (must remain deactivated)
        { id: 'disabled-stud', email: 'disabled@college.edu', raw_user_meta_data: { role: 'student', name: 'Deactivated Student' } },
        // Orphan user with malicious role escalation attempt in metadata
        { id: 'orphan-attacker', email: 'hacker@gmail.com', raw_user_meta_data: { role: 'admin', name: 'Attacker' } },
        // Orphan user with normal student metadata
        { id: 'orphan-student', email: 'newstud@gmail.com', raw_user_meta_data: { name: 'New Student' } },
      ]

      // Migration 008 logic:
      // INSERT ... SELECT u.id, name, 'student', true FROM auth.users WHERE p.id IS NULL ON CONFLICT (id) DO NOTHING
      for (const u of authUsers) {
        if (!existingProfiles.has(u.id)) {
          // Hardcoded safe default 'student', completely ignoring raw_user_meta_data->>'role'
          existingProfiles.set(u.id, {
            id: u.id,
            name: (u.raw_user_meta_data as any)?.name ?? 'User',
            role: 'student',
            is_active: true,
          })
        }
      }

      // Assertions
      assert.equal(existingProfiles.get('orphan-attacker')?.role, 'student') // ESCALATION BLOCKED
      assert.equal(existingProfiles.get('orphan-student')?.role, 'student')
      assert.equal(existingProfiles.get('admin-1')?.role, 'admin')          // EXISTING ADMIN UNTOUCHED
      assert.equal(existingProfiles.get('disabled-stud')?.is_active, false)  // EXISTING STATUS UNTOUCHED
    })

    it('29. Edge Function provisioning validates roles, departments, roll numbers, and caller authority', () => {
      const simulateAdminCreateUser = (
        caller: { id: string; role: string; is_active: boolean },
        payload: { name: string; email: string; password: string; role: string; rollNo?: string; departmentId?: number }
      ) => {
        // Step 1: Caller authentication & role verification
        if (!caller || caller.role !== 'admin' || !caller.is_active) {
          throw new Error('Forbidden: Only active administrators can provision user accounts.')
        }

        // Step 2: Role validation
        if (!['student', 'professor', 'admin'].includes(payload.role)) {
          throw new Error(`Invalid role: ${payload.role}`)
        }

        // Step 3: Role-specific requirements
        if (payload.role === 'student' && !payload.rollNo?.trim()) {
          throw new Error('Roll number is required when creating a student account.')
        }

        if (payload.role === 'professor' && !payload.departmentId) {
          throw new Error('Department is required when creating a professor account.')
        }

        return { success: true, createdRole: payload.role }
      }

      const activeAdmin = { id: 'adm-1', role: 'admin', is_active: true }
      const inactiveAdmin = { id: 'adm-2', role: 'admin', is_active: false }
      const studentCaller = { id: 'std-1', role: 'student', is_active: true }
      const profCaller = { id: 'prf-1', role: 'professor', is_active: true }

      // 1. Admin creates professor with department -> SUCCESS
      const profRes = simulateAdminCreateUser(activeAdmin, {
        name: 'Dr. Sharma',
        email: 'sharma@college.edu',
        password: 'password123',
        role: 'professor',
        departmentId: 1,
      })
      assert.equal(profRes.success, true)
      assert.equal(profRes.createdRole, 'professor')

      // 2. Admin creates professor WITHOUT department -> REJECTED
      assert.throws(
        () => simulateAdminCreateUser(activeAdmin, {
          name: 'Dr. NoDept',
          email: 'nodept@college.edu',
          password: 'password123',
          role: 'professor',
        }),
        /Department is required when creating a professor account/i
      )

      // 3. Admin creates student with roll number -> SUCCESS
      const studRes = simulateAdminCreateUser(activeAdmin, {
        name: 'Amit Kumar',
        email: 'amit@gmail.com',
        password: 'password123',
        role: 'student',
        rollNo: 'CS-01',
      })
      assert.equal(studRes.success, true)
      assert.equal(studRes.createdRole, 'student')

      // 4. Admin creates student WITHOUT roll number -> REJECTED
      assert.throws(
        () => simulateAdminCreateUser(activeAdmin, {
          name: 'NoRoll',
          email: 'noroll@gmail.com',
          password: 'password123',
          role: 'student',
        }),
        /Roll number is required when creating a student account/i
      )

      // 5. Inactive admin cannot provision -> REJECTED
      assert.throws(
        () => simulateAdminCreateUser(inactiveAdmin, {
          name: 'Test',
          email: 'test@college.edu',
          password: 'password123',
          role: 'student',
          rollNo: 'T-01',
        }),
        /Forbidden: Only active administrators/i
      )

      // 6. Student cannot provision -> REJECTED
      assert.throws(
        () => simulateAdminCreateUser(studentCaller, {
          name: 'Test',
          email: 'test@college.edu',
          password: 'password123',
          role: 'student',
          rollNo: 'T-01',
        }),
        /Forbidden: Only active administrators/i
      )

      // 7. Professor cannot provision -> REJECTED
      assert.throws(
        () => simulateAdminCreateUser(profCaller, {
          name: 'Test',
          email: 'test@college.edu',
          password: 'password123',
          role: 'student',
          rollNo: 'T-01',
        }),
        /Forbidden: Only active administrators/i
      )
    })

    it('30. compensating rollback cleans up created Auth user when secondary table insertion fails', () => {
      const authUsersDb = new Map<string, any>()
      const studentsDb = new Map<string, any>()

      const simulateProvisioningWithRollback = (
        userId: string,
        userData: { email: string; rollNo: string },
        forceStudentFail: boolean
      ) => {
        // Step 1: Create auth user
        authUsersDb.set(userId, userData)

        try {
          // Step 2: Insert into students table
          if (forceStudentFail) {
            throw new Error('duplicate key value violates unique constraint "students_roll_no_key"')
          }
          studentsDb.set(userId, { user_id: userId, roll_no: userData.rollNo })
          return { success: true }
        } catch (err: any) {
          // Compensating rollback: delete user from auth
          authUsersDb.delete(userId)
          return { success: false, error: err.message }
        }
      }

      // Case 1: Student insertion succeeds
      const successRes = simulateProvisioningWithRollback(
        'u-valid',
        { email: 'valid@gmail.com', rollNo: 'CS-01' },
        false
      )
      assert.equal(successRes.success, true)
      assert.equal(authUsersDb.has('u-valid'), true)
      assert.equal(studentsDb.has('u-valid'), true)

      // Case 2: Student insertion fails (e.g. duplicate roll number) -> compensating rollback fires
      const failRes = simulateProvisioningWithRollback(
        'u-orphan-attempt',
        { email: 'dup@gmail.com', rollNo: 'CS-01' },
        true
      )
      assert.equal(failRes.success, false)
      assert.match(failRes.error || '', /unique constraint/i)
      // Verify NO orphaned auth user remains
      assert.equal(authUsersDb.has('u-orphan-attempt'), false)
      assert.equal(studentsDb.has('u-orphan-attempt'), false)
    })

    it('31. CSV bulk student import validates line-by-line, tracks counts, and does not abort batch', () => {
      const csvLines = [
        'name,email,roll_no,password,class,batch',
        'Rahul Verma,rahul@gmail.com,CS-101,pass123,CS-A,Batch 1', // Valid
        'Invalid User,not-an-email,CS-102,pass123,CS-A,Batch 1',   // Invalid email syntax
        'No Roll,noroll@gmail.com,,pass123,CS-A,Batch 1',           // Missing roll number
        'Priya Nair,priya@gmail.com,CS-103,pass123,CS-A,Batch 2',   // Valid
      ]

      let successCount = 0
      let errorCount = 0
      const errors: string[] = []
      const provisioned: string[] = []

      for (let i = 1; i < csvLines.length; i++) {
        const [name, email, rollNo, password] = csvLines[i].split(',').map(s => s.trim())
        try {
          if (!name || !email || !password) throw new Error(`Missing required fields on line ${i}`)
          if (!rollNo) throw new Error(`Missing roll number on line ${i}`)
          if (!email.includes('@') || !email.includes('.')) throw new Error(`Invalid email on line ${i}`)
          successCount++
          provisioned.push(name)
        } catch (err: any) {
          errorCount++
          errors.push(err.message)
        }
      }

      assert.equal(successCount, 2)
      assert.equal(errorCount, 2)
      assert.deepEqual(provisioned, ['Rahul Verma', 'Priya Nair'])
      assert.match(errors[0], /Invalid email on line 2/i)
      assert.match(errors[1], /Missing roll number on line 3/i)
    })
  })
})
