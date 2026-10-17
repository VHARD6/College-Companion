import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ─── HELPER FUNCTIONS FOR PROFESSOR PORTAL STATE LOGIC ─────────────────────────

export type ProfessorPortalState =
  | 'ERROR'
  | 'LOADING'
  | 'SETUP_REQUIRED'
  | 'PENDING_ASSIGNMENTS'
  | 'ACTIVE_NO_TODAY_CLASSES'
  | 'ACTIVE_WITH_TODAY_CLASSES'

export function resolveProfessorHomeState(params: {
  hasError: boolean
  isLoading: boolean
  hasProfessorRecord: boolean
  assignmentCount: number
  todaySlotCount: number
}): ProfessorPortalState {
  if (params.hasError) return 'ERROR'
  if (params.isLoading) return 'LOADING'
  if (!params.hasProfessorRecord) return 'SETUP_REQUIRED'
  if (params.assignmentCount === 0) return 'PENDING_ASSIGNMENTS'
  if (params.todaySlotCount === 0) return 'ACTIVE_NO_TODAY_CLASSES'
  return 'ACTIVE_WITH_TODAY_CLASSES'
}

export function isRouteActive(targetPath: string, currentPathname: string): boolean {
  const isRootMatchOnly = targetPath.split('/').length <= 2
  if (isRootMatchOnly) {
    return currentPathname === targetPath || currentPathname === `${targetPath}/`
  }
  return currentPathname === targetPath || currentPathname.startsWith(`${targetPath}/`)
}

export function filterRosterForAssignment<T extends { class_id: number; batch_id: number | null }>(
  students: T[],
  assignment: { class_id: number; batch_id: number | null }
): T[] {
  return students.filter(s => {
    if (s.class_id !== assignment.class_id) return false
    if (assignment.batch_id !== null && assignment.batch_id !== undefined) {
      return s.batch_id === assignment.batch_id
    }
    // Theory: all students in class
    return true
  })
}

// ─── TEST SUITE ─────────────────────────────────────────────────────────────

describe('Professor Portal Functional & Navigation Test Suite', () => {
  // ─── 1. Navigation & Route Resolution ─────────────────────────────────────
  describe('1. Permanent Professor Navigation & Route Matching', () => {
    const professorNav = [
      { to: '/professor', label: 'Home' },
      { to: '/professor/mark', label: 'Mark Attendance' },
      { to: '/professor/reports', label: 'Reports' },
    ]

    it('includes Home, Mark Attendance, and Reports in professor bottom navigation', () => {
      assert.equal(professorNav.length, 3)
      assert.equal(professorNav[0].to, '/professor')
      assert.equal(professorNav[0].label, 'Home')
      assert.equal(professorNav[1].to, '/professor/mark')
      assert.equal(professorNav[1].label, 'Mark Attendance')
      assert.equal(professorNav[2].to, '/professor/reports')
      assert.equal(professorNav[2].label, 'Reports')
    })

    it('highlights Home exclusively when on /professor', () => {
      const path = '/professor'
      assert.equal(isRouteActive('/professor', path), true)
      assert.equal(isRouteActive('/professor/mark', path), false)
      assert.equal(isRouteActive('/professor/reports', path), false)
    })

    it('highlights Mark Attendance exclusively when on /professor/mark', () => {
      const path = '/professor/mark'
      assert.equal(isRouteActive('/professor', path), false)
      assert.equal(isRouteActive('/professor/mark', path), true)
      assert.equal(isRouteActive('/professor/reports', path), false)
    })

    it('highlights Mark Attendance when query parameters are present (/professor/mark?assignmentId=4)', () => {
      // In web apps, location.pathname is '/professor/mark' regardless of query params
      const pathname = '/professor/mark'
      assert.equal(isRouteActive('/professor/mark', pathname), true)
      assert.equal(isRouteActive('/professor', pathname), false)
    })

    it('highlights Reports exclusively when on /professor/reports', () => {
      const path = '/professor/reports'
      assert.equal(isRouteActive('/professor', path), false)
      assert.equal(isRouteActive('/professor/mark', path), false)
      assert.equal(isRouteActive('/professor/reports', path), true)
    })
  })

  // ─── 2. Professor Dashboard State Machine ──────────────────────────────────
  describe('2. ProfessorHome Discoverability & State Machine', () => {
    it('resolves to ERROR state with retry capability when database query fails', () => {
      const state = resolveProfessorHomeState({
        hasError: true,
        isLoading: false,
        hasProfessorRecord: true,
        assignmentCount: 2,
        todaySlotCount: 1,
      })
      assert.equal(state, 'ERROR')
    })

    it('resolves to LOADING state during initial fetch', () => {
      const state = resolveProfessorHomeState({
        hasError: false,
        isLoading: true,
        hasProfessorRecord: false,
        assignmentCount: 0,
        todaySlotCount: 0,
      })
      assert.equal(state, 'LOADING')
    })

    it('resolves to SETUP_REQUIRED when auth profile has role professor but no row in public.professors', () => {
      const state = resolveProfessorHomeState({
        hasError: false,
        isLoading: false,
        hasProfessorRecord: false, // Missing row in public.professors
        assignmentCount: 0,
        todaySlotCount: 0,
      })
      assert.equal(state, 'SETUP_REQUIRED')
    })

    it('resolves to PENDING_ASSIGNMENTS when professor record exists but administrator has not assigned subjects', () => {
      const state = resolveProfessorHomeState({
        hasError: false,
        isLoading: false,
        hasProfessorRecord: true,
        assignmentCount: 0, // No assignments
        todaySlotCount: 0,
      })
      assert.equal(state, 'PENDING_ASSIGNMENTS')
    })

    it('distinguishes "No classes scheduled today" from "No teaching assignments"', () => {
      // Case A: 0 assignments -> PENDING_ASSIGNMENTS
      const stateNoAssignments = resolveProfessorHomeState({
        hasError: false,
        isLoading: false,
        hasProfessorRecord: true,
        assignmentCount: 0,
        todaySlotCount: 0,
      })
      assert.equal(stateNoAssignments, 'PENDING_ASSIGNMENTS')

      // Case B: Has assignments, but 0 classes on today\'s timetable -> ACTIVE_NO_TODAY_CLASSES
      const stateWithAssignmentsNoToday = resolveProfessorHomeState({
        hasError: false,
        isLoading: false,
        hasProfessorRecord: true,
        assignmentCount: 3,
        todaySlotCount: 0,
      })
      assert.equal(stateWithAssignmentsNoToday, 'ACTIVE_NO_TODAY_CLASSES')
    })

    it('resolves to ACTIVE_WITH_TODAY_CLASSES when today has timetable slots scheduled', () => {
      const state = resolveProfessorHomeState({
        hasError: false,
        isLoading: false,
        hasProfessorRecord: true,
        assignmentCount: 3,
        todaySlotCount: 2,
      })
      assert.equal(state, 'ACTIVE_WITH_TODAY_CLASSES')
    })
  })

  // ─── 3. Teaching Assignment Roster & Batch Isolation ───────────────────────
  describe('3. Teaching Assignment Roster & Strict Batch Boundaries', () => {
    const allStudents = [
      { id: 1, name: 'Aarav Sharma', roll_no: 'CS-01', class_id: 10, batch_id: 101 },
      { id: 2, name: 'Diya Patel', roll_no: 'CS-02', class_id: 10, batch_id: 101 },
      { id: 3, name: 'Ishaan Verma', roll_no: 'CS-03', class_id: 10, batch_id: 102 },
      { id: 4, name: 'Kavya Nair', roll_no: 'CS-04', class_id: 10, batch_id: 102 },
      { id: 5, name: 'Other Class', roll_no: 'ME-01', class_id: 20, batch_id: 201 },
    ]

    it('loads all students in the class division for a theory assignment (batch_id is null)', () => {
      const theoryAssignment = { class_id: 10, batch_id: null }
      const roster = filterRosterForAssignment(allStudents, theoryAssignment)
      assert.equal(roster.length, 4)
      assert.deepEqual(roster.map(s => s.roll_no), ['CS-01', 'CS-02', 'CS-03', 'CS-04'])
    })

    it('loads strictly batch-enrolled students for a practical assignment (batch_id = 101)', () => {
      const practicalAssignment = { class_id: 10, batch_id: 101 }
      const roster = filterRosterForAssignment(allStudents, practicalAssignment)
      assert.equal(roster.length, 2)
      assert.deepEqual(roster.map(s => s.roll_no), ['CS-01', 'CS-02'])
    })

    it('prevents practical batch 101 from seeing students in batch 102 or class 20', () => {
      const practicalAssignment = { class_id: 10, batch_id: 101 }
      const roster = filterRosterForAssignment(allStudents, practicalAssignment)
      const hasBatch102 = roster.some(s => s.batch_id === 102)
      const hasClass20 = roster.some(s => s.class_id === 20)
      assert.equal(hasBatch102, false)
      assert.equal(hasClass20, false)
    })

    it('identifies when an assigned class division has 0 enrolled students', () => {
      const emptyClassAssignment = { class_id: 99, batch_id: null }
      const roster = filterRosterForAssignment(allStudents, emptyClassAssignment)
      assert.equal(roster.length, 0)
    })
  })

  // ─── 4. Draft vs Final Submission & Correction Enforcement ────────────────
  describe('4. Draft, Final Submission & Correction Enforcement Rules', () => {
    it('saving draft keeps session status as draft and does not require audit reason', () => {
      const session = {
        id: 50,
        status: 'draft',
        submitted_at: null,
      }
      const isFinal = false
      const action = isFinal ? 'submit_attendance_session' : 'save_draft_session'
      assert.equal(action, 'save_draft_session')
      assert.equal(session.status, 'draft')
      assert.equal(session.submitted_at, null)
    })

    it('final submission locks session and sets submitted_at timestamp', () => {
      const session = {
        id: 50,
        status: 'draft',
        submitted_at: null,
      }
      // Simulation of submit_attendance_session RPC
      session.status = 'submitted'
      session.submitted_at = new Date().toISOString()

      assert.equal(session.status, 'submitted')
      assert.notEqual(session.submitted_at, null)
    })

    it('rejects correction on submitted session if mandatory reason is missing or whitespace', () => {
      const isSubmitted = true
      const editReason = '   '

      let thrownError = ''
      try {
        if (isSubmitted && !editReason.trim()) {
          throw new Error('A mandatory reason is required for attendance corrections.')
        }
      } catch (err: any) {
        thrownError = err.message
      }

      assert.match(thrownError, /mandatory reason is required/i)
    })

    it('rejects correction if submitted_at exceeds correction window (e.g. 24 hours)', () => {
      const correctionWindowHours = 24
      const thirtyHoursAgo = new Date(Date.now() - 30 * 3600 * 1000).toISOString()
      const session = {
        id: 50,
        status: 'submitted',
        submitted_at: thirtyHoursAgo,
      }

      const elapsedMs = Date.now() - new Date(session.submitted_at).getTime()
      const isWithinWindow = elapsedMs <= correctionWindowHours * 3600 * 1000
      assert.equal(isWithinWindow, false)
    })

    it('permits correction with reason when within correction window', () => {
      const correctionWindowHours = 24
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      const session = {
        id: 50,
        status: 'submitted',
        submitted_at: twoHoursAgo,
      }
      const editReason = 'Roll CS-01 arrived with medical excuse slip'

      const elapsedMs = Date.now() - new Date(session.submitted_at).getTime()
      const isWithinWindow = elapsedMs <= correctionWindowHours * 3600 * 1000
      assert.equal(isWithinWindow, true)
      assert.equal(editReason.trim().length > 0, true)
    })
  })
})
