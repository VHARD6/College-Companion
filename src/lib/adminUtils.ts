/**
 * Admin utilities for entity relation normalization, derived branch resolution,
 * and academic assignment validation.
 */

/**
 * Safely extracts a 1:1 related record whether PostgREST returns it as a
 * single object (standard for unique foreign key relationships) or a 1-element array.
 */
export function extractSingleRelation<T = any>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  if (Array.isArray(rel)) {
    return rel.length > 0 ? (rel[0] ?? null) : null
  }
  return rel
}

export interface DerivedBranchInfo {
  branchName: string | null
  className: string | null
  semester: number | null
  academicYear: string | null
}

/**
 * Derives a student's academic branch from their enrolled class hierarchy:
 * students.class_id -> classes.department_id -> departments.name.
 *
 * Students do not possess a standalone department_id column in the schema.
 */
export function deriveStudentBranch(studentRec: any, classesList?: any[]): DerivedBranchInfo {
  if (!studentRec || !studentRec.class_id) {
    return {
      branchName: null,
      className: null,
      semester: null,
      academicYear: null,
    }
  }

  // 1. Try embedded class details on student record
  const embeddedClass = studentRec.classes
  if (embeddedClass) {
    const dept = extractSingleRelation(embeddedClass.departments)
    const branchName = dept?.name ?? null
    return {
      branchName,
      className: embeddedClass.name ?? null,
      semester: embeddedClass.semester ?? null,
      academicYear: embeddedClass.academic_year ?? null,
    }
  }

  // 2. Fall back to lookup in provided classes list
  if (classesList && classesList.length > 0) {
    const matchedClass = classesList.find(c => Number(c.id) === Number(studentRec.class_id))
    if (matchedClass) {
      const dept = extractSingleRelation(matchedClass.departments)
      return {
        branchName: dept?.name ?? null,
        className: matchedClass.name ?? null,
        semester: matchedClass.semester ?? null,
        academicYear: matchedClass.academic_year ?? null,
      }
    }
  }

  return {
    branchName: null,
    className: null,
    semester: null,
    academicYear: null,
  }
}

/**
 * Validates student enrollment parameters before submitting an admin mutation.
 */
export function validateEnrollmentInput(
  rollNo: string,
  classId: string | number | null | undefined,
  batchId: string | number | null | undefined,
  availableBatches?: { id: number; class_id: number }[]
): { isValid: boolean; error?: string } {
  const trimmedRoll = rollNo ? String(rollNo).trim() : ''
  if (!trimmedRoll) {
    return { isValid: false, error: 'Roll number is required.' }
  }

  const numClassId = classId !== '' && classId !== null && classId !== undefined ? Number(classId) : null
  const numBatchId = batchId !== '' && batchId !== null && batchId !== undefined ? Number(batchId) : null

  if (numClassId !== null && isNaN(numClassId)) {
    return { isValid: false, error: 'Invalid class ID provided.' }
  }

  if (numBatchId !== null && isNaN(numBatchId)) {
    return { isValid: false, error: 'Invalid batch ID provided.' }
  }

  // A batch cannot be assigned without an enrolled class
  if (numBatchId !== null && numClassId === null) {
    return { isValid: false, error: 'Cannot assign a practical batch without selecting a class division.' }
  }

  // If batch list for class is known, verify batch belongs to the selected class
  if (numBatchId !== null && numClassId !== null && availableBatches && availableBatches.length > 0) {
    const validBatch = availableBatches.find(b => b.id === numBatchId && b.class_id === numClassId)
    if (!validBatch) {
      return { isValid: false, error: 'Selected batch does not belong to the selected class division.' }
    }
  }

  return { isValid: true }
}

/**
 * Normalizes parameters for teaching assignment queries and checks.
 * Ensures batch_id uses `.eq()` when numerical and `.is('batch_id', null)` when absent,
 * preventing PostgREST syntax errors.
 */
export function buildTeachingAssignmentQueryConfig(
  professorId: string | number,
  subjectId: string | number,
  classId: string | number,
  batchId?: string | number | null
): {
  isValid: boolean
  error?: string
  professorId: number
  subjectId: number
  classId: number
  batchId: number | null
  isBatchNull: boolean
} {
  const pId = Number(professorId)
  const sId = Number(subjectId)
  const cId = Number(classId)

  if (!professorId || isNaN(pId)) {
    return { isValid: false, error: 'Valid professor is required.', professorId: 0, subjectId: 0, classId: 0, batchId: null, isBatchNull: true }
  }
  if (!subjectId || isNaN(sId)) {
    return { isValid: false, error: 'Valid subject is required.', professorId: 0, subjectId: 0, classId: 0, batchId: null, isBatchNull: true }
  }
  if (!classId || isNaN(cId)) {
    return { isValid: false, error: 'Valid class division is required.', professorId: 0, subjectId: 0, classId: 0, batchId: null, isBatchNull: true }
  }

  const bId = batchId !== '' && batchId !== null && batchId !== undefined ? Number(batchId) : null
  if (bId !== null && isNaN(bId)) {
    return { isValid: false, error: 'Invalid batch ID.', professorId: pId, subjectId: sId, classId: cId, batchId: null, isBatchNull: true }
  }

  return {
    isValid: true,
    professorId: pId,
    subjectId: sId,
    classId: cId,
    batchId: bId,
    isBatchNull: bId === null,
  }
}
