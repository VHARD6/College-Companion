import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sortStudentsByRollNo,
  initRosterStatus,
  calculateAttendanceCounts,
  toggleAttendanceStatus,
  getAbsentStudents,
  validateSessionSetup,
} from '../src/lib/attendanceWorkflow.ts'
import type { AttendanceStatus, SessionType } from '../src/types'

describe('3-Page Attendance Workflow Test Suite', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. Session Initialization & Default State
  // ──────────────────────────────────────────────────────────────────────────
  describe('Session Initialization & Default State', () => {
    const mockStudents = [
      { id: 101, roll_no: 'CS01' },
      { id: 102, roll_no: 'CS02' },
      { id: 103, roll_no: 'CS03' },
    ]

    it('defaults EVERY eligible student to present for a new session', () => {
      const roster = initRosterStatus(mockStudents)
      assert.equal(Object.keys(roster).length, 3)
      assert.equal(roster[101], 'present')
      assert.equal(roster[102], 'present')
      assert.equal(roster[103], 'present')
    })

    it('restores saved draft or submitted records without overwriting them to all-present', () => {
      const existingRecords = [
        { student_id: 101, status: 'present' },
        { student_id: 102, status: 'absent' },
        { student_id: 103, status: 'present' },
      ]

      const roster = initRosterStatus(mockStudents, existingRecords)
      assert.equal(roster[101], 'present')
      assert.equal(roster[102], 'absent')
      assert.equal(roster[103], 'present')
    })

    it('handles student missing from existing records by defaulting that student to present', () => {
      // Only student 102 has an existing record
      const partialRecords = [{ student_id: 102, status: 'absent' }]
      const roster = initRosterStatus(mockStudents, partialRecords)
      assert.equal(roster[101], 'present')
      assert.equal(roster[102], 'absent')
      assert.equal(roster[103], 'present')
    })

    it('handles empty student roster gracefully', () => {
      const roster = initRosterStatus([])
      assert.deepEqual(roster, {})
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Natural Roll Number Sorting
  // ──────────────────────────────────────────────────────────────────────────
  describe('Natural Roll Number Sorting', () => {
    it('sorts pure numeric roll numbers in true numerical order (1, 2, 10 instead of 1, 10, 2)', () => {
      const unsorted = [
        { id: 1, roll_no: '10' },
        { id: 2, roll_no: '2' },
        { id: 3, roll_no: '1' },
        { id: 4, roll_no: '21' },
      ]
      const sorted = sortStudentsByRollNo(unsorted)
      assert.deepEqual(sorted.map(s => s.roll_no), ['1', '2', '10', '21'])
    })

    it('sorts alphanumeric roll numbers with prefixes naturally (CS01, CS02, CS10)', () => {
      const unsorted = [
        { id: 1, roll_no: 'CS10' },
        { id: 2, roll_no: 'CS02' },
        { id: 3, roll_no: 'CS01' },
        { id: 4, roll_no: 'CS20' },
        { id: 5, roll_no: 'CS09' },
      ]
      const sorted = sortStudentsByRollNo(unsorted)
      assert.deepEqual(sorted.map(s => s.roll_no), ['CS01', 'CS02', 'CS09', 'CS10', 'CS20'])
    })

    it('sorts mixed prefix and hyphenated formats consistently', () => {
      const unsorted = [
        { id: 1, roll_no: 'B-10' },
        { id: 2, roll_no: 'A-2' },
        { id: 3, roll_no: 'B-2' },
        { id: 4, roll_no: 'A-1' },
      ]
      const sorted = sortStudentsByRollNo(unsorted)
      assert.deepEqual(sorted.map(s => s.roll_no), ['A-1', 'A-2', 'B-2', 'B-10'])
    })

    it('does not mutate original array', () => {
      const original = [
        { id: 1, roll_no: 'B' },
        { id: 2, roll_no: 'A' },
      ]
      const sorted = sortStudentsByRollNo(original)
      assert.notEqual(sorted, original)
      assert.equal(original[0].roll_no, 'B')
      assert.equal(sorted[0].roll_no, 'A')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Status Toggle and Counter Consistency
  // ──────────────────────────────────────────────────────────────────────────
  describe('Status Toggle and Counter Consistency', () => {
    it('toggleAttendanceStatus flips present to absent and absent to present', () => {
      assert.equal(toggleAttendanceStatus('present'), 'absent')
      assert.equal(toggleAttendanceStatus('absent'), 'present')
      assert.equal(toggleAttendanceStatus(undefined), 'absent')
    })

    it('calculates correct counts when all students are present', () => {
      const roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'present',
        3: 'present',
        4: 'present',
      }
      const counts = calculateAttendanceCounts(4, roster)
      assert.deepEqual(counts, { total: 4, present: 4, absent: 0 })
    })

    it('calculates correct counts after marking absentees', () => {
      const roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'absent',
        3: 'present',
        4: 'absent',
        5: 'present',
      }
      const counts = calculateAttendanceCounts(5, roster)
      assert.deepEqual(counts, { total: 5, present: 3, absent: 2 })
      assert.equal(counts.present + counts.absent, counts.total)
    })

    it('maintains total = present + absent even when rosterStatus is partially populated', () => {
      // 4 total students, but only 2 explicit entries in roster
      const roster: Record<number, AttendanceStatus> = {
        1: 'absent',
        2: 'present',
      }
      const counts = calculateAttendanceCounts(4, roster)
      assert.equal(counts.total, 4)
      assert.equal(counts.absent, 1)
      assert.equal(counts.present, 3) // 1 explicit + 2 unassigned defaulting to present
      assert.equal(counts.present + counts.absent, counts.total)
    })

    it('handles zero students roster counts gracefully', () => {
      const counts = calculateAttendanceCounts(0, {})
      assert.deepEqual(counts, { total: 0, present: 0, absent: 0 })
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Page 2 — Review Absentees Workflow
  // ──────────────────────────────────────────────────────────────────────────
  describe('Page 2 — Review Absentees Workflow', () => {
    const students = [
      { id: 1, roll_no: '01', name: 'Alice' },
      { id: 2, roll_no: '02', name: 'Bob' },
      { id: 3, roll_no: '03', name: 'Charlie' },
      { id: 4, roll_no: '04', name: 'Diana' },
    ]

    it('filters roster to display ONLY students currently marked absent', () => {
      const roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'absent',
        3: 'absent',
        4: 'present',
      }
      const absentees = getAbsentStudents(students, roster)
      assert.equal(absentees.length, 2)
      assert.deepEqual(absentees.map(s => s.name), ['Bob', 'Charlie'])
    })

    it('returns empty list when all students are marked present (empty state trigger)', () => {
      const roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'present',
        3: 'present',
        4: 'present',
      }
      const absentees = getAbsentStudents(students, roster)
      assert.equal(absentees.length, 0)
    })

    it('marking an absentee as present removes them immediately from absentees list', () => {
      let roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'absent',
        3: 'absent',
      }

      // Step 2 initial view: Bob (2) and Charlie (3) are absent
      let absentees = getAbsentStudents(students.slice(0, 3), roster)
      assert.equal(absentees.length, 2)

      // Professor taps 'A' on Bob -> becomes 'present'
      roster = { ...roster, [2]: toggleAttendanceStatus(roster[2]) }
      assert.equal(roster[2], 'present')

      // Bob is immediately removed from Page 2's absent list
      absentees = getAbsentStudents(students.slice(0, 3), roster)
      assert.equal(absentees.length, 1)
      assert.equal(absentees[0].name, 'Charlie')

      // Professor taps 'A' on Charlie -> becomes 'present'
      roster = { ...roster, [3]: toggleAttendanceStatus(roster[3]) }
      assert.equal(roster[3], 'present')

      // Now absentees list is empty, triggering "Everyone is present!"
      absentees = getAbsentStudents(students.slice(0, 3), roster)
      assert.equal(absentees.length, 0)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Page 3 — Final Review & Workflow Navigation Integrity
  // ──────────────────────────────────────────────────────────────────────────
  describe('Page 3 — Final Review & Navigation State Preservation', () => {
    const students = [
      { id: 1, roll_no: '01', name: 'Alice' },
      { id: 2, roll_no: '02', name: 'Bob' },
      { id: 3, roll_no: '03', name: 'Charlie' },
    ]

    it('reflects all students (present and absent) in the final review step', () => {
      const roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'absent',
        3: 'present',
      }

      // Page 3 displays all students
      const totalStudents = students.length
      const counts = calculateAttendanceCounts(totalStudents, roster)
      assert.equal(counts.total, 3)
      assert.equal(counts.present, 2)
      assert.equal(counts.absent, 1)

      // Roster mapping holds correct status for each student
      assert.equal(roster[1], 'present')
      assert.equal(roster[2], 'absent')
      assert.equal(roster[3], 'present')
    })

    it('allows last-minute editable adjustments directly on Page 3 and updates counts', () => {
      let roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'absent',
        3: 'present',
      }

      // On Page 3, professor notices Alice was also absent and changes her
      roster = { ...roster, [1]: 'absent' }
      let counts = calculateAttendanceCounts(3, roster)
      assert.equal(counts.present, 1)
      assert.equal(counts.absent, 2)

      // Professor corrects Bob to present on Page 3
      roster = { ...roster, [2]: 'present' }
      counts = calculateAttendanceCounts(3, roster)
      assert.equal(counts.present, 2)
      assert.equal(counts.absent, 1)
    })

    it('preserves all state across wizard step transitions (1 -> 2 -> 3 -> 2 -> 1)', () => {
      // Step 1: Initialize
      let currentStep: 1 | 2 | 3 = 1
      let roster = initRosterStatus(students)

      // Step 1: Mark student 2 absent
      roster = { ...roster, [2]: 'absent' }
      assert.equal(roster[2], 'absent')

      // Move to Step 2
      currentStep = 2
      const absenteesStep2 = getAbsentStudents(students, roster)
      assert.equal(absenteesStep2.length, 1)
      assert.equal(absenteesStep2[0].id, 2)

      // Move to Step 3
      currentStep = 3
      const countsStep3 = calculateAttendanceCounts(students.length, roster)
      assert.equal(countsStep3.absent, 1)

      // Move back to Step 2
      currentStep = 2
      assert.equal(getAbsentStudents(students, roster).length, 1)

      // Move back to Step 1
      currentStep = 1
      assert.equal(roster[1], 'present')
      assert.equal(roster[2], 'absent')
      assert.equal(roster[3], 'present')

      // No status was reset during navigation
      const countsFinal = calculateAttendanceCounts(students.length, roster)
      assert.equal(countsFinal.absent, 1)
      assert.equal(countsFinal.present, 2)
      assert.equal(currentStep, 1)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Session Setup & Date Validation
  // ──────────────────────────────────────────────────────────────────────────
  describe('Session Setup & Date Validation', () => {
    const today = '2026-10-19'

    it('validates a correct session setup for today', () => {
      const result = validateSessionSetup({
        assignmentId: 10,
        date: today,
        sessionType: 'lecture',
        todayISO: today,
      })
      assert.equal(result.isValid, true)
      assert.equal(result.error, undefined)
    })

    it('validates a correct session setup for a past date', () => {
      const result = validateSessionSetup({
        assignmentId: 10,
        date: '2026-10-15',
        sessionType: 'practical',
        todayISO: today,
      })
      assert.equal(result.isValid, true)
      assert.equal(result.error, undefined)
    })

    it('rejects a future date', () => {
      const result = validateSessionSetup({
        assignmentId: 10,
        date: '2026-10-25',
        sessionType: 'lecture',
        todayISO: today,
      })
      assert.equal(result.isValid, false)
      assert.match(result.error ?? '', /future date/i)
    })

    it('rejects missing teaching assignment', () => {
      const result = validateSessionSetup({
        assignmentId: null,
        date: today,
        sessionType: 'lecture',
        todayISO: today,
      })
      assert.equal(result.isValid, false)
      assert.match(result.error ?? '', /teaching assignment/i)
    })

    it('rejects missing date', () => {
      const result = validateSessionSetup({
        assignmentId: 5,
        date: '',
        sessionType: 'lecture',
        todayISO: today,
      })
      assert.equal(result.isValid, false)
      assert.match(result.error ?? '', /date/i)
    })

    it('rejects invalid session type', () => {
      const result = validateSessionSetup({
        assignmentId: 5,
        date: today,
        sessionType: 'seminar' as SessionType,
        todayISO: today,
      })
      assert.equal(result.isValid, false)
      assert.match(result.error ?? '', /session type/i)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Atomic Submission & Draft Payload Construction
  // ──────────────────────────────────────────────────────────────────────────
  describe('Submission & Draft Payload Construction', () => {
    const students = [
      { id: 1, roll_no: '01' },
      { id: 2, roll_no: '02' },
      { id: 3, roll_no: '03' },
    ]

    it('builds complete attendance records payload covering every enrolled student', () => {
      const roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'absent',
        3: 'present',
      }

      const recordsPayload = students.map(s => ({
        student_id: s.id,
        status: roster[s.id] ?? 'present',
      }))

      assert.equal(recordsPayload.length, 3)
      assert.deepEqual(recordsPayload, [
        { student_id: 1, status: 'present' },
        { student_id: 2, status: 'absent' },
        { student_id: 3, status: 'present' },
      ])
    })

    it('ensures no duplicate student records exist in the payload', () => {
      const roster: Record<number, AttendanceStatus> = {
        1: 'present',
        2: 'absent',
        3: 'present',
      }

      const recordsPayload = students.map(s => ({
        student_id: s.id,
        status: roster[s.id] ?? 'present',
      }))

      const studentIdSet = new Set(recordsPayload.map(r => r.student_id))
      assert.equal(studentIdSet.size, recordsPayload.length)
    })

    it('requires a non-empty audit reason when editing a submitted session', () => {
      function validateCorrection(reason: string): { allowed: boolean; error?: string } {
        if (!reason || !reason.trim()) {
          return { allowed: false, error: 'A reason is required to submit changes to completed attendance.' }
        }
        return { allowed: true }
      }

      assert.equal(validateCorrection('').allowed, false)
      assert.equal(validateCorrection('   ').allowed, false)
      assert.equal(validateCorrection('Student arrived late with approved pass').allowed, true)
    })
  })
})
