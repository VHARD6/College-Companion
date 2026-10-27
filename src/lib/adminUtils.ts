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

/**
 * Parses a single CSV line following RFC 4180 rules:
 * - Handles quotes, escaped quotes (""), and commas inside quotes.
 * - Trims outer whitespace around fields.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0

  while (i < line.length) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i += 2
          continue
        } else {
          inQuotes = false
          i++
          continue
        }
      } else {
        current += char
        i++
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
      } else if (char === ',') {
        fields.push(current.trim())
        current = ''
        i++
      } else {
        current += char
        i++
      }
    }
  }
  fields.push(current.trim())
  return fields
}

export interface ParsedCsvData {
  headers: string[]
  rows: string[][]
  error?: string
}

/**
 * Parses and validates raw CSV import text.
 * Enforces maximum size (1MB) and maximum row limit (500 rows)
 * to prevent denial-of-service and browser hangs.
 */
export function parseCsvInput(csvText: string, maxRows = 500): ParsedCsvData {
  if (!csvText || typeof csvText !== 'string' || !csvText.trim()) {
    return { headers: [], rows: [], error: 'CSV content is empty.' }
  }

  if (csvText.length > 1024 * 1024) {
    return { headers: [], rows: [], error: 'CSV content exceeds maximum allowed size (1 MB).' }
  }

  // Normalize line breaks: replace CRLF and CR with LF
  const rawLines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines = rawLines.map(l => l.trim()).filter(l => l.length > 0)

  if (lines.length <= 1) {
    return { headers: [], rows: [], error: 'CSV must contain a header row and at least one data row.' }
  }

  const rowCount = lines.length - 1
  if (rowCount > maxRows) {
    return {
      headers: [],
      rows: [],
      error: `CSV contains ${rowCount} rows. Maximum allowed is ${maxRows} rows per batch to prevent browser instability.`,
    }
  }

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const rows: string[][] = []

  for (let i = 1; i < lines.length; i++) {
    const parsedRow = parseCsvLine(lines[i])
    rows.push(parsedRow)
  }

  return { headers, rows }
}

export interface CsvImportOutcome {
  status: 'success' | 'partial' | 'failure' | 'empty'
  message: string
  shouldClearInput: boolean
  shouldCloseModal: boolean
}

/**
 * Evaluates the result counts of a CSV batch import to determine
 * clear, accurate, and non-misleading user feedback.
 */
export function evaluateCsvImportOutcome(successCount: number, errorCount: number): CsvImportOutcome {
  if (successCount === 0 && errorCount === 0) {
    return {
      status: 'empty',
      message: 'No valid rows to import.',
      shouldClearInput: false,
      shouldCloseModal: false,
    }
  }

  if (errorCount === 0 && successCount > 0) {
    return {
      status: 'success',
      message: `CSV Import complete: ${successCount} user${successCount === 1 ? '' : 's'} added successfully.`,
      shouldClearInput: true,
      shouldCloseModal: true,
    }
  }

  if (successCount > 0 && errorCount > 0) {
    return {
      status: 'partial',
      message: `CSV Import partially succeeded: ${successCount} added, ${errorCount} failed. Check console for details.`,
      shouldClearInput: false,
      shouldCloseModal: false,
    }
  }

  return {
    status: 'failure',
    message: `CSV Import failed: 0 added, ${errorCount} error${errorCount === 1 ? '' : 's'}. Please fix errors and retry.`,
    shouldClearInput: false,
    shouldCloseModal: false,
  }
}
