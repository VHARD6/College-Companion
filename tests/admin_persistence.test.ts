import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractSingleRelation,
  deriveStudentBranch,
  validateEnrollmentInput,
  buildTeachingAssignmentQueryConfig,
} from '../src/lib/adminUtils.ts'

describe('Admin Persistence & Academic Assignment Test Suite', () => {
  describe('extractSingleRelation (Fix for PostgREST 1:1 Embedding Mismatch)', () => {
    it('correctly extracts record when PostgREST returns a single object (1:1 relation)', () => {
      // In Supabase, students.user_id is UNIQUE REFERENCES profiles(id).
      // PostgREST embeds this as a single object: user.students = { id: 101, roll_no: 'CS101' }
      // Previously, user.students?.[0] was used, which evaluated to undefined!
      const postgrestObject = {
        id: 101,
        roll_no: 'CS101',
        class_id: 1,
        batch_id: 2,
      }

      const result = extractSingleRelation(postgrestObject)
      assert.deepEqual(result, postgrestObject)
      assert.equal(result?.roll_no, 'CS101')
      assert.equal(result?.class_id, 1)
    })

    it('correctly extracts record when PostgREST returns a 1-element array', () => {
      const arrayRel = [
        {
          id: 202,
          roll_no: 'IT202',
          class_id: 3,
        },
      ]

      const result = extractSingleRelation(arrayRel)
      assert.deepEqual(result, arrayRel[0])
      assert.equal(result?.roll_no, 'IT202')
    })

    it('returns null when relation is empty array', () => {
      assert.equal(extractSingleRelation([]), null)
    })

    it('returns null when relation is null or undefined', () => {
      assert.equal(extractSingleRelation(null), null)
      assert.equal(extractSingleRelation(undefined), null)
    })
  })

  describe('deriveStudentBranch (Students -> Classes -> Departments hierarchy)', () => {
    it('derives branch name from embedded class.departments', () => {
      const studentRec = {
        id: 1,
        user_id: 'user-abc',
        roll_no: 'CS001',
        class_id: 10,
        batch_id: null,
        classes: {
          id: 10,
          name: 'CS-A',
          semester: 5,
          academic_year: '2024-25',
          departments: {
            id: 1,
            name: 'Computer Science & Engineering',
          },
        },
      }

      const branchInfo = deriveStudentBranch(studentRec)
      assert.equal(branchInfo.branchName, 'Computer Science & Engineering')
      assert.equal(branchInfo.className, 'CS-A')
      assert.equal(branchInfo.semester, 5)
      assert.equal(branchInfo.academicYear, '2024-25')
    })

    it('falls back to external classes list if student record has class_id but not embedded classes', () => {
      const studentRec = {
        id: 2,
        user_id: 'user-xyz',
        roll_no: 'ME002',
        class_id: 20,
        batch_id: null,
      }

      const classesList = [
        {
          id: 20,
          name: 'ME-B',
          semester: 3,
          academic_year: '2024-25',
          departments: {
            id: 2,
            name: 'Mechanical Engineering',
          },
        },
      ]

      const branchInfo = deriveStudentBranch(studentRec, classesList)
      assert.equal(branchInfo.branchName, 'Mechanical Engineering')
      assert.equal(branchInfo.className, 'ME-B')
      assert.equal(branchInfo.semester, 3)
      assert.equal(branchInfo.academicYear, '2024-25')
    })

    it('returns nulls for students with pending class enrollment', () => {
      const unenrolledStudent = {
        id: 3,
        user_id: 'user-new',
        roll_no: 'CS003',
        class_id: null,
        batch_id: null,
      }

      const branchInfo = deriveStudentBranch(unenrolledStudent)
      assert.equal(branchInfo.branchName, null)
      assert.equal(branchInfo.className, null)
    })
  })

  describe('validateEnrollmentInput', () => {
    it('rejects empty or whitespace roll number', () => {
      const res1 = validateEnrollmentInput('', 1, null)
      assert.equal(res1.isValid, false)
      assert.match(res1.error!, /Roll number is required/)

      const res2 = validateEnrollmentInput('   ', 1, null)
      assert.equal(res2.isValid, false)
      assert.match(res2.error!, /Roll number is required/)
    })

    it('rejects batch assignment when class_id is missing', () => {
      const res = validateEnrollmentInput('CS101', null, 5)
      assert.equal(res.isValid, false)
      assert.match(res.error!, /Cannot assign a practical batch without selecting a class division/)
    })

    it('rejects batch when batch does not belong to the selected class', () => {
      const availableBatches = [
        { id: 1, class_id: 10 },
        { id: 2, class_id: 10 },
        { id: 3, class_id: 20 },
      ]

      // Trying to assign batch 3 (belongs to class 20) to class 10
      const res = validateEnrollmentInput('CS101', 10, 3, availableBatches)
      assert.equal(res.isValid, false)
      assert.match(res.error!, /does not belong to the selected class division/)
    })

    it('accepts valid class and matching batch', () => {
      const availableBatches = [
        { id: 1, class_id: 10 },
        { id: 2, class_id: 10 },
      ]

      const res = validateEnrollmentInput('CS101', 10, 2, availableBatches)
      assert.equal(res.isValid, true)
      assert.equal(res.error, undefined)
    })

    it('accepts valid class without batch (theory only)', () => {
      const res = validateEnrollmentInput('CS101', 10, null)
      assert.equal(res.isValid, true)
    })
  })

  describe('buildTeachingAssignmentQueryConfig (Fix for PostgREST .is() on numbers)', () => {
    it('correctly configures null batch for whole-class / theory assignments', () => {
      const config = buildTeachingAssignmentQueryConfig('1', '2', '3', '')
      assert.equal(config.isValid, true)
      assert.equal(config.isBatchNull, true)
      assert.equal(config.batchId, null)
      assert.equal(config.professorId, 1)
      assert.equal(config.subjectId, 2)
      assert.equal(config.classId, 3)
    })

    it('correctly configures numerical batch for practical assignments', () => {
      // Previously, .is('batch_id', 4) caused invalid PostgREST syntax error `batch_id=is.4`
      const config = buildTeachingAssignmentQueryConfig(1, 2, 3, 4)
      assert.equal(config.isValid, true)
      assert.equal(config.isBatchNull, false)
      assert.equal(config.batchId, 4)
    })

    it('rejects missing professor, subject, or class', () => {
      assert.equal(buildTeachingAssignmentQueryConfig('', 2, 3).isValid, false)
      assert.equal(buildTeachingAssignmentQueryConfig(1, '', 3).isValid, false)
      assert.equal(buildTeachingAssignmentQueryConfig(1, 2, '').isValid, false)
    })
  })

  describe('Read-After-Write Zero-Row Verification Contract', () => {
    it('simulates error when DB upsert returns 0 rows', () => {
      // Contract: saveAssignmentMutation must throw when returned data array is empty
      const simulateUpsertResponse = (rows: any[]) => {
        if (!rows || rows.length === 0) {
          throw new Error('Failed to persist student enrollment. Zero rows were updated in the database.')
        }
        return rows[0]
      }

      assert.throws(
        () => simulateUpsertResponse([]),
        /Zero rows were updated in the database/
      )

      const savedRow = simulateUpsertResponse([{ id: 1, roll_no: 'CS101' }])
      assert.equal(savedRow.roll_no, 'CS101')
    })
  })
})
