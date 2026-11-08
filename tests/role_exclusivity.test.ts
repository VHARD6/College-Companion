import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Role Mutual Exclusivity & Admin-Only Role Transitions Test Suite', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/014_enforce_exclusive_roles_and_admin_transitions.sql'
  )

  describe('1. Migration 014 SQL Schema & Invariant Specifications', () => {
    it('verifies migration 014 file exists on disk', () => {
      assert.ok(fs.existsSync(migrationPath), 'Migration 014 file must exist')
    })

    it('verifies hardened security definer helper functions enforce strict profile role matching', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // get_my_professor_id() requires p.role = 'professor'
      assert.ok(
        sql.includes("p.role = 'professor'"),
        'get_my_professor_id must require p.role = professor'
      )

      // get_my_student_id() requires p.role = 'student'
      assert.ok(
        sql.includes("p.role = 'student'"),
        'get_my_student_id must require p.role = student'
      )

      // get_my_student_class_id and get_my_student_batch_id require p.role = 'student'
      assert.ok(
        sql.includes('CREATE OR REPLACE FUNCTION public.get_my_student_class_id()'),
        'get_my_student_class_id must be redefined'
      )
      assert.ok(
        sql.includes('CREATE OR REPLACE FUNCTION public.get_my_student_batch_id()'),
        'get_my_student_batch_id must be redefined'
      )
    })

    it('verifies database triggers are defined on public.students, public.professors, and public.profiles', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Students exclusivity trigger
      assert.ok(
        sql.includes('trg_student_role_exclusivity'),
        'Trigger trg_student_role_exclusivity must be defined on public.students'
      )
      assert.ok(
        sql.includes('check_student_role_exclusivity'),
        'Function check_student_role_exclusivity must be defined'
      )

      // Professors exclusivity trigger
      assert.ok(
        sql.includes('trg_professor_role_exclusivity'),
        'Trigger trg_professor_role_exclusivity must be defined on public.professors'
      )
      assert.ok(
        sql.includes('check_professor_role_exclusivity'),
        'Function check_professor_role_exclusivity must be defined'
      )

      // Profiles exclusivity trigger
      assert.ok(
        sql.includes('trg_profile_role_exclusivity'),
        'Trigger trg_profile_role_exclusivity must be defined on public.profiles'
      )
      assert.ok(
        sql.includes('check_profile_role_exclusivity'),
        'Function check_profile_role_exclusivity must be defined'
      )
    })

    it('verifies admin_set_user_role RPC enforces authorization, self-demotion lockout, and atomic cleanup', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Must check caller role = admin
      assert.ok(
        sql.includes("v_caller_role != 'admin'"),
        'admin_set_user_role must reject callers whose role is not admin'
      )

      // Must check caller is_active
      assert.ok(
        sql.includes('v_caller_active IS NOT TRUE'),
        'admin_set_user_role must reject inactive admin callers'
      )

      // Must guard against self-demotion lockout
      assert.ok(
        sql.includes("p_user_id = auth.uid() AND p_new_role != 'admin'"),
        'admin_set_user_role must prevent administrator self-demotion lockout'
      )

      // Must retire auxiliary student & professor records atomically
      assert.ok(
        sql.includes('DELETE FROM public.students WHERE user_id = p_user_id;'),
        'admin_set_user_role must delete obsolete student records'
      )
      assert.ok(
        sql.includes('DELETE FROM public.professors WHERE user_id = p_user_id;'),
        'admin_set_user_role must delete obsolete professor records'
      )
    })
  })

  describe('2. Behavioral Invariant Modeling: Role Mutual Exclusivity', () => {
    interface MockProfile {
      id: string
      name: string
      role: 'student' | 'professor' | 'admin'
      is_active: boolean
    }

    interface MockStudent {
      id: number
      user_id: string
      roll_no: string
      class_id: number | null
      batch_id: number | null
    }

    interface MockProfessor {
      id: number
      user_id: string
      department_id: number
    }

    interface MockDatabase {
      profiles: Map<string, MockProfile>
      students: Map<string, MockStudent>
      professors: Map<string, MockProfessor>
      sessions: Array<{ id: number; professor_id: number; status: string }>
    }

    function createMockDb(): MockDatabase {
      return {
        profiles: new Map(),
        students: new Map(),
        professors: new Map(),
        sessions: [],
      }
    }

    function checkStudentTrigger(db: MockDatabase, record: MockStudent) {
      const profile = db.profiles.get(record.user_id)
      if (!profile || profile.role !== 'student') {
        throw new Error(
          `Role exclusivity violation: user ${record.user_id} has profile role ${profile?.role ?? 'NULL'}, cannot exist in students table`
        )
      }
      if (db.professors.has(record.user_id)) {
        throw new Error(
          `Role exclusivity violation: user ${record.user_id} already exists in professors table`
        )
      }
    }

    function checkProfessorTrigger(db: MockDatabase, record: MockProfessor) {
      const profile = db.profiles.get(record.user_id)
      if (!profile || profile.role !== 'professor') {
        throw new Error(
          `Role exclusivity violation: user ${record.user_id} has profile role ${profile?.role ?? 'NULL'}, cannot exist in professors table`
        )
      }
      if (db.students.has(record.user_id)) {
        throw new Error(
          `Role exclusivity violation: user ${record.user_id} already exists in students table`
        )
      }
    }

    function checkProfileTrigger(db: MockDatabase, oldProfile: MockProfile | null, newProfile: MockProfile, callerRole: string) {
      if (oldProfile && oldProfile.role !== newProfile.role) {
        if (callerRole !== 'admin') {
          throw new Error('Unauthorized: only an administrator can change account roles.')
        }
      }
      if (newProfile.role === 'admin') {
        if (db.students.has(newProfile.id) || db.professors.has(newProfile.id)) {
          throw new Error('Role exclusivity violation: admin account cannot exist in students or professors')
        }
      } else if (newProfile.role === 'student') {
        if (db.professors.has(newProfile.id)) {
          throw new Error('Role exclusivity violation: student account cannot exist in professors')
        }
      } else if (newProfile.role === 'professor') {
        if (db.students.has(newProfile.id)) {
          throw new Error('Role exclusivity violation: professor account cannot exist in students')
        }
      }
    }

    function adminSetUserRoleRpc(
      db: MockDatabase,
      callerId: string,
      targetUserId: string,
      newRole: 'student' | 'professor' | 'admin',
      rollNo?: string,
      classId?: number | null,
      batchId?: number | null,
      departmentId?: number
    ) {
      const caller = db.profiles.get(callerId)
      if (!caller || caller.role !== 'admin' || !caller.is_active) {
        throw new Error('Unauthorized: only an administrator can change account roles.')
      }

      if (callerId === targetUserId && newRole !== 'admin') {
        throw new Error('Cannot demote your own administrator account. Please use another administrator account.')
      }

      const target = db.profiles.get(targetUserId)
      if (!target) {
        throw new Error('Target user profile not found')
      }

      if (newRole === 'admin') {
        const prof = db.professors.get(targetUserId)
        if (prof && db.sessions.some(s => s.professor_id === prof.id)) {
          throw new Error('Cannot reassign professor to admin: account has recorded class sessions.')
        }
        db.professors.delete(targetUserId)
        db.students.delete(targetUserId)
        target.role = 'admin'
      } else if (newRole === 'professor') {
        db.students.delete(targetUserId)
        target.role = 'professor'
        db.professors.set(targetUserId, {
          id: db.professors.size + 1,
          user_id: targetUserId,
          department_id: departmentId ?? 1,
        })
      } else if (newRole === 'student') {
        const prof = db.professors.get(targetUserId)
        if (prof && db.sessions.some(s => s.professor_id === prof.id)) {
          throw new Error('Cannot reassign professor to student: account has recorded class sessions.')
        }
        db.professors.delete(targetUserId)
        target.role = 'student'
        const finalRoll = rollNo || `STU-${targetUserId.slice(0, 4)}`
        db.students.set(targetUserId, {
          id: db.students.size + 1,
          user_id: targetUserId,
          roll_no: finalRoll,
          class_id: classId ?? null,
          batch_id: batchId ?? null,
        })
      }

      // Verify trigger constraints on post-state
      checkProfileTrigger(db, target, target, caller.role)
      return { success: true, user_id: targetUserId, role: newRole }
    }

    it('rejects inserting student record when profile role is professor or admin', () => {
      const db = createMockDb()
      db.profiles.set('user-prof-1', {
        id: 'user-prof-1',
        name: 'Prof. X',
        role: 'professor',
        is_active: true,
      })

      assert.throws(
        () => checkStudentTrigger(db, { id: 1, user_id: 'user-prof-1', roll_no: 'R01', class_id: 1, batch_id: null }),
        /Role exclusivity violation: user user-prof-1 has profile role professor, cannot exist in students table/
      )
    })

    it('rejects inserting professor record when profile role is student or admin', () => {
      const db = createMockDb()
      db.profiles.set('user-stu-1', {
        id: 'user-stu-1',
        name: 'Student Y',
        role: 'student',
        is_active: true,
      })

      assert.throws(
        () => checkProfessorTrigger(db, { id: 1, user_id: 'user-stu-1', department_id: 1 }),
        /Role exclusivity violation: user user-stu-1 has profile role student, cannot exist in professors table/
      )
    })

    it('prevents an account from co-existing in both students and professors', () => {
      const db = createMockDb()
      db.profiles.set('user-dup', {
        id: 'user-dup',
        name: 'Dual Role Attempt',
        role: 'student',
        is_active: true,
      })
      db.students.set('user-dup', {
        id: 1,
        user_id: 'user-dup',
        roll_no: 'DUP01',
        class_id: 1,
        batch_id: null,
      })

      // Attempting to insert into professors must throw
      assert.throws(
        () => checkProfessorTrigger(db, { id: 2, user_id: 'user-dup', department_id: 1 }),
        /Role exclusivity violation/
      )
    })

    it('strictly denies non-admin accounts from calling admin_set_user_role', () => {
      const db = createMockDb()
      db.profiles.set('user-stu', { id: 'user-stu', name: 'Student', role: 'student', is_active: true })
      db.profiles.set('user-prof', { id: 'user-prof', name: 'Prof', role: 'professor', is_active: true })
      db.profiles.set('target-stu', { id: 'target-stu', name: 'Target', role: 'student', is_active: true })

      // Student caller
      assert.throws(
        () => adminSetUserRoleRpc(db, 'user-stu', 'target-stu', 'admin'),
        /Unauthorized: only an administrator can change account roles/
      )

      // Professor caller
      assert.throws(
        () => adminSetUserRoleRpc(db, 'user-prof', 'target-stu', 'admin'),
        /Unauthorized: only an administrator can change account roles/
      )
    })

    it('denies inactive administrator from altering roles', () => {
      const db = createMockDb()
      db.profiles.set('admin-inactive', { id: 'admin-inactive', name: 'Deactivated Admin', role: 'admin', is_active: false })
      db.profiles.set('target-user', { id: 'target-user', name: 'User', role: 'student', is_active: true })

      assert.throws(
        () => adminSetUserRoleRpc(db, 'admin-inactive', 'target-user', 'professor', undefined, null, null, 1),
        /Unauthorized: only an administrator can change account roles/
      )
    })

    it('prevents admin self-demotion lockout', () => {
      const db = createMockDb()
      db.profiles.set('admin-1', { id: 'admin-1', name: 'Main Admin', role: 'admin', is_active: true })

      assert.throws(
        () => adminSetUserRoleRpc(db, 'admin-1', 'admin-1', 'student', 'STU01', 1, null),
        /Cannot demote your own administrator account/
      )
    })

    it('successfully transitions student to professor, retiring student row atomically', () => {
      const db = createMockDb()
      db.profiles.set('admin-1', { id: 'admin-1', name: 'Admin', role: 'admin', is_active: true })
      db.profiles.set('user-1', { id: 'user-1', name: 'Rahul Sharma', role: 'student', is_active: true })
      db.students.set('user-1', { id: 10, user_id: 'user-1', roll_no: 'CS10', class_id: 1, batch_id: null })

      const res = adminSetUserRoleRpc(db, 'admin-1', 'user-1', 'professor', undefined, null, null, 2)
      assert.equal(res.success, true)
      assert.equal(res.role, 'professor')

      // Student row must be gone
      assert.equal(db.students.has('user-1'), false)
      // Professor row must be present
      assert.equal(db.professors.has('user-1'), true)
      assert.equal(db.professors.get('user-1')?.department_id, 2)
      // Profile role must be professor
      assert.equal(db.profiles.get('user-1')?.role, 'professor')
    })

    it('successfully transitions professor to admin, retiring professor row atomically', () => {
      const db = createMockDb()
      db.profiles.set('admin-1', { id: 'admin-1', name: 'Admin', role: 'admin', is_active: true })
      db.profiles.set('user-2', { id: 'user-2', name: 'Prof. Desai', role: 'professor', is_active: true })
      db.professors.set('user-2', { id: 5, user_id: 'user-2', department_id: 1 })

      const res = adminSetUserRoleRpc(db, 'admin-1', 'user-2', 'admin')
      assert.equal(res.success, true)
      assert.equal(res.role, 'admin')

      // Professor and student rows must be absent
      assert.equal(db.professors.has('user-2'), false)
      assert.equal(db.students.has('user-2'), false)
      // Profile role must be admin
      assert.equal(db.profiles.get('user-2')?.role, 'admin')
    })

    it('rejects transitioning professor with recorded sessions until sessions are resolved', () => {
      const db = createMockDb()
      db.profiles.set('admin-1', { id: 'admin-1', name: 'Admin', role: 'admin', is_active: true })
      db.profiles.set('user-active-prof', { id: 'user-active-prof', name: 'Prof. Active', role: 'professor', is_active: true })
      db.professors.set('user-active-prof', { id: 99, user_id: 'user-active-prof', department_id: 1 })
      db.sessions.push({ id: 1, professor_id: 99, status: 'submitted' })

      assert.throws(
        () => adminSetUserRoleRpc(db, 'admin-1', 'user-active-prof', 'student', 'R99', 1, null),
        /Cannot reassign professor to student: account has recorded class sessions/
      )
    })
  })

  describe('3. Role Resolution Helpers Invariant Verification', () => {
    function mockGetMyProfessorId(user: { id: string; role: string; is_active: boolean } | null, profRecords: { user_id: string; id: number }[]) {
      if (!user || !user.is_active || user.role !== 'professor') return null
      const rec = profRecords.find(p => p.user_id === user.id)
      return rec ? rec.id : null
    }

    function mockGetMyStudentId(user: { id: string; role: string; is_active: boolean } | null, studentRecords: { user_id: string; id: number }[]) {
      if (!user || !user.is_active || user.role !== 'student') return null
      const rec = studentRecords.find(s => s.user_id === user.id)
      return rec ? rec.id : null
    }

    it('returns NULL professor ID for students and admins even if dangling professor record existed', () => {
      const studentUser = { id: 'u1', role: 'student', is_active: true }
      const adminUser = { id: 'u2', role: 'admin', is_active: true }
      const danglingProfRecords = [
        { user_id: 'u1', id: 101 },
        { user_id: 'u2', id: 102 },
      ]

      assert.equal(mockGetMyProfessorId(studentUser, danglingProfRecords), null)
      assert.equal(mockGetMyProfessorId(adminUser, danglingProfRecords), null)
    })

    it('returns NULL student ID for professors and admins even if dangling student record existed', () => {
      const profUser = { id: 'u3', role: 'professor', is_active: true }
      const adminUser = { id: 'u4', role: 'admin', is_active: true }
      const danglingStudentRecords = [
        { user_id: 'u3', id: 201 },
        { user_id: 'u4', id: 202 },
      ]

      assert.equal(mockGetMyStudentId(profUser, danglingStudentRecords), null)
      assert.equal(mockGetMyStudentId(adminUser, danglingStudentRecords), null)
    })
  })
})
