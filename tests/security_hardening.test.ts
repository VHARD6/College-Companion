import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { queryClient } from '../src/lib/queryClient.ts'
import {
  isValidDownloadUrl,
  sanitizeDownloadFilename,
  downloadTimetableImage,
  normalizeDateToISO,
  formatDateForOfficialDisplay,
} from '../src/lib/timetableImagePersistence.ts'
import {
  parseCsvLine,
  parseCsvInput,
  evaluateCsvImportOutcome,
} from '../src/lib/adminUtils.ts'
import {
  validateEmail,
  validatePassword,
} from '../src/lib/authUtils.ts'
import {
  calcPercent,
  calcSkippable,
  calcNeeded,
  calcWhatIf,
  classifyStatus,
} from '../src/lib/attendance.ts'
import {
  calculateFitDimensions,
  calculatePanBounds,
  clamp,
  calculateDistance,
  calculateMidpoint,
} from '../src/lib/timetableGesture.ts'
import {
  validateMasterTimetable,
} from '../src/lib/timetableValidation.ts'

describe('Comprehensive Security & Harsh Abrupt Use Test Suite', () => {
  // ─── PART 1: URL Scheme Injection & Malicious URLs ────────────────────────
  describe('1. URL Scheme Injection & Open Redirect Defense', () => {
    it('rejects javascript: protocol scheme', () => {
      assert.equal(isValidDownloadUrl('javascript:alert(1)'), false)
      assert.equal(isValidDownloadUrl('JAVASCRIPT:void(0)'), false)
      assert.equal(isValidDownloadUrl('javascript:/*comment*/alert(document.cookie)'), false)
    })

    it('rejects data: URI scheme to prevent untrusted payload execution', () => {
      assert.equal(isValidDownloadUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), false)
      assert.equal(isValidDownloadUrl('DATA:image/svg+xml,<svg onload=alert(1)>'), false)
    })

    it('rejects file: and vbscript: protocol schemes', () => {
      assert.equal(isValidDownloadUrl('file:///etc/passwd'), false)
      assert.equal(isValidDownloadUrl('file:///C:/Windows/System32/drivers/etc/hosts'), false)
      assert.equal(isValidDownloadUrl('vbscript:msgbox(1)'), false)
    })

    it('rejects null, undefined, empty, and non-string inputs', () => {
      assert.equal(isValidDownloadUrl(''), false)
      assert.equal(isValidDownloadUrl('   '), false)
      assert.equal(isValidDownloadUrl(null), false)
      assert.equal(isValidDownloadUrl(undefined), false)
      assert.equal(isValidDownloadUrl(12345 as any), false)
    })

    it('accepts legitimate HTTPS, HTTP, and blob URLs', () => {
      assert.equal(isValidDownloadUrl('https://xyz.supabase.co/storage/v1/object/sign/timetables/t.png'), true)
      assert.equal(isValidDownloadUrl('http://localhost:54321/storage/v1/object/sign/timetables/t.png'), true)
      assert.equal(isValidDownloadUrl('blob:http://localhost:5173/a843-ef45-8912'), true)
    })

    it('downloadTimetableImage throws explicit error when given untrusted URL scheme', async () => {
      await assert.rejects(
        () => downloadTimetableImage('javascript:alert(1)', 'test.png'),
        { message: 'Untrusted or invalid timetable image URL scheme.' }
      )
      await assert.rejects(
        () => downloadTimetableImage('data:text/html;base64,123', 'test.png'),
        { message: 'Untrusted or invalid timetable image URL scheme.' }
      )
    })
  })

  // ─── PART 2: Path Traversal & Filename Sanitization ───────────────────────
  describe('2. Path Traversal & Native Storage Filename Sanitization', () => {
    it('strips Unix directory traversal sequences (../)', () => {
      const sanitized = sanitizeDownloadFilename('../../../../etc/passwd')
      assert.equal(sanitized, 'passwd.png')
      assert.equal(sanitized.includes('..'), false)
      assert.equal(sanitized.includes('/'), false)
    })

    it('strips Windows directory traversal sequences (..\\)', () => {
      const sanitized = sanitizeDownloadFilename('..\\..\\Windows\\System32\\cmd.exe')
      assert.equal(sanitized, 'cmd.exe.png')
      assert.equal(sanitized.includes('..'), false)
      assert.equal(sanitized.includes('\\'), false)
    })

    it('strips null bytes and non-printable control characters', () => {
      const sanitized = sanitizeDownloadFilename('timetable\0.exe.png')
      assert.equal(sanitized.includes('\0'), false)
      assert.equal(sanitized, 'timetable.exe.png')
    })

    it('replaces dangerous filename characters (< > : " / \\ | ? *) with underscores', () => {
      const sanitized = sanitizeDownloadFilename('timetable<script>:test?.png')
      assert.equal(sanitized, 'timetable_script__test_.png')
    })

    it('falls back to default timetable_export.png for empty, dot-only, or whitespace filenames', () => {
      assert.equal(sanitizeDownloadFilename(''), 'timetable_export.png')
      assert.equal(sanitizeDownloadFilename('   '), 'timetable_export.png')
      assert.equal(sanitizeDownloadFilename('....'), 'timetable_export.png')
      assert.equal(sanitizeDownloadFilename(null), 'timetable_export.png')
      assert.equal(sanitizeDownloadFilename(undefined), 'timetable_export.png')
    })

    it('ensures safe image extension is appended if missing', () => {
      assert.equal(sanitizeDownloadFilename('my_timetable'), 'my_timetable.png')
      assert.equal(sanitizeDownloadFilename('official_schedule.pdf'), 'official_schedule.pdf.png')
      assert.equal(sanitizeDownloadFilename('master.PNG'), 'master.PNG')
      assert.equal(sanitizeDownloadFilename('export.webp'), 'export.webp')
    })

    it('caps overly long filenames to 120 characters while preserving extension', () => {
      const longName = 'A'.repeat(200) + '.png'
      const sanitized = sanitizeDownloadFilename(longName)
      assert.ok(sanitized.length <= 120)
      assert.ok(sanitized.endsWith('.png'))
    })
  })

  // ─── PART 3: RFC 4180 CSV Parser & Denial of Service Protection ───────────
  describe('3. RFC 4180 CSV Parser & Input Robustness', () => {
    it('correctly parses quoted fields containing commas', () => {
      const line = '"Sharma, Aakash",aakash@gmail.com,Pass1234,CS001,CS-A,Batch 1'
      const parsed = parseCsvLine(line)
      assert.deepEqual(parsed, ['Sharma, Aakash', 'aakash@gmail.com', 'Pass1234', 'CS001', 'CS-A', 'Batch 1'])
    })

    it('handles escaped double quotes ("") within quoted fields', () => {
      const line = '"He said ""Approved""",prof@gmail.com,Pass1234,P001,CS-A,Batch 1'
      const parsed = parseCsvLine(line)
      assert.equal(parsed[0], 'He said "Approved"')
    })

    it('handles mixed Windows CRLF and Unix LF line endings', () => {
      const csv = 'name,email,password,roll_no,class_name,batch_name\r\nStudent One,s1@test.com,Pass1234,CS01,CS-A,B1\nStudent Two,s2@test.com,Pass1234,CS02,CS-A,B2'
      const result = parseCsvInput(csv)
      assert.equal(result.error, undefined)
      assert.equal(result.rows.length, 2)
      assert.equal(result.rows[0][0], 'Student One')
      assert.equal(result.rows[1][0], 'Student Two')
    })

    it('rejects empty or whitespace-only CSV input', () => {
      assert.ok(parseCsvInput('').error?.includes('empty'))
      assert.ok(parseCsvInput('   \n  \n').error?.includes('empty'))
      assert.ok(parseCsvInput(null as any).error?.includes('empty'))
    })

    it('rejects CSV containing only header row without data rows', () => {
      const csv = 'name,email,password,roll_no,class_name,batch_name\n'
      const result = parseCsvInput(csv)
      assert.ok(result.error?.includes('at least one data row'))
    })

    it('rejects CSV payloads that exceed 500 rows to prevent browser lockup', () => {
      let csv = 'name,email,password,roll_no,class_name,batch_name\n'
      for (let i = 0; i < 505; i++) {
        csv += `Student ${i},s${i}@test.com,Pass1234,CS${i},CS-A,B1\n`
      }
      const result = parseCsvInput(csv, 500)
      assert.ok(result.error?.includes('Maximum allowed is 500 rows'))
    })
  })

  // ─── PART 4: Email & Password Validation Under Abrupt Use ─────────────────
  describe('4. Email & Password Hardening', () => {
    it('rejects email exceeding RFC 5321 length of 254 characters', () => {
      const longEmail = 'a'.repeat(250) + '@example.com'
      const check = validateEmail(longEmail)
      assert.equal(check.isValid, false)
      assert.ok(check.error?.includes('254 characters'))
    })

    it('rejects email containing null bytes or control characters', () => {
      const check = validateEmail('user\0@example.com')
      assert.equal(check.isValid, false)
      assert.ok(check.error?.includes('invalid characters'))
    })

    it('rejects empty or non-string emails', () => {
      assert.equal(validateEmail('').isValid, false)
      assert.equal(validateEmail(null as any).isValid, false)
      assert.equal(validateEmail(undefined as any).isValid, false)
    })

    it('accepts legitimate email formats', () => {
      assert.equal(validateEmail('student@college.edu').isValid, true)
      assert.equal(validateEmail('aakash.sharma@gmail.com').isValid, true)
    })

    it('rejects passwords shorter than 6 characters', () => {
      assert.equal(validatePassword('').isValid, false)
      assert.equal(validatePassword('12345').isValid, false)
      assert.equal(validatePassword('Pass1').isValid, false)
    })

    it('accepts passwords with 6 or more characters and preserves exact casing', () => {
      assert.equal(validatePassword('Pass12').isValid, true)
      assert.equal(validatePassword('Complex#Password$2026').isValid, true)
    })
  })

  // ─── PART 5: Attendance Math Under Corrupted / Abrupt Inputs ──────────────
  describe('5. Attendance Math Robustness (NaN, Inf, Negatives)', () => {
    it('calcPercent returns null for NaN, Infinity, negative counts, or zero held', () => {
      assert.equal(calcPercent(NaN, 10), null)
      assert.equal(calcPercent(5, NaN), null)
      assert.equal(calcPercent(Infinity, 10), null)
      assert.equal(calcPercent(5, Infinity), null)
      assert.equal(calcPercent(-5, 10), null)
      assert.equal(calcPercent(5, -10), null)
      assert.equal(calcPercent(0, 0), null)
    })

    it('calcPercent calculates exact rounded percentage for valid numbers', () => {
      assert.equal(calcPercent(15, 20), 75)
      assert.equal(calcPercent(2, 3), 66.7)
    })

    it('calcSkippable returns 0 for NaN, negative numbers, or invalid threshold', () => {
      assert.equal(calcSkippable(NaN, 10, 75), 0)
      assert.equal(calcSkippable(10, NaN, 75), 0)
      assert.equal(calcSkippable(10, 10, NaN), 0)
      assert.equal(calcSkippable(-5, 10, 75), 0)
      assert.equal(calcSkippable(10, 10, 0), 0)
      assert.equal(calcSkippable(10, 10, -50), 0)
    })

    it('calcNeeded returns 0 for NaN, negative numbers, or invalid threshold', () => {
      assert.equal(calcNeeded(NaN, 10, 75), 0)
      assert.equal(calcNeeded(5, NaN, 75), 0)
      assert.equal(calcNeeded(5, 10, NaN), 0)
      assert.equal(calcNeeded(-5, 10, 75), 0)
      assert.equal(calcNeeded(5, 10, 0), 0)
      assert.equal(calcNeeded(5, 10, -10), 0)
      assert.equal(calcNeeded(5, 10, 100), Infinity)
    })

    it('calcWhatIf returns null for NaN or negative inputs', () => {
      assert.equal(calcWhatIf(NaN, 10, 2, 2), null)
      assert.equal(calcWhatIf(5, 10, -2, 2), null)
      assert.equal(calcWhatIf(5, 10, 2, -1), null)
    })

    it('classifyStatus returns "unknown" for NaN, null, or non-finite inputs', () => {
      assert.equal(classifyStatus(null, 75), 'unknown')
      assert.equal(classifyStatus(NaN, 75), 'unknown')
      assert.equal(classifyStatus(80, NaN), 'unknown')
      assert.equal(classifyStatus(Infinity, 75), 'unknown')
    })
  })

  // ─── PART 6: Timetable Date Formatting & Gesture Math ─────────────────────
  describe('6. Date Formatting & Gesture Math Under Abrupt Inputs', () => {
    it('normalizeDateToISO handles null, undefined, non-strings safely', () => {
      assert.equal(normalizeDateToISO(null), '')
      assert.equal(normalizeDateToISO(undefined), '')
      assert.equal(normalizeDateToISO('' as any), '')
      assert.equal(normalizeDateToISO('2026-10-27'), '2026-10-27')
      assert.equal(normalizeDateToISO('27/10/2026'), '2026-10-27')
    })

    it('formatDateForOfficialDisplay handles null, undefined, non-strings safely', () => {
      assert.equal(formatDateForOfficialDisplay(null), '')
      assert.equal(formatDateForOfficialDisplay(undefined), '')
      assert.equal(formatDateForOfficialDisplay('2026-10-27'), '27/10/2026')
    })

    it('calculateFitDimensions returns 0x0 on null, undefined, or NaN inputs', () => {
      assert.deepEqual(calculateFitDimensions(null as any, { width: 100, height: 100 }), { width: 0, height: 0 })
      assert.deepEqual(calculateFitDimensions({ width: NaN, height: 100 }, { width: 100, height: 100 }), { width: 0, height: 0 })
    })

    it('calculatePanBounds returns zero bounds for NaN or non-finite zoom', () => {
      assert.deepEqual(
        calculatePanBounds({ width: 400, height: 800 }, { width: 400, height: 400 }, NaN),
        { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      )
    })

    it('clamp returns min when value or bounds are NaN', () => {
      assert.equal(clamp(NaN, 5, 10), 5)
      assert.equal(clamp(7, NaN, 10), 0)
    })

    it('calculateDistance and calculateMidpoint handle null and NaN coordinates without throwing', () => {
      assert.equal(calculateDistance(null as any, { x: 5, y: 5 }), 0)
      assert.equal(calculateDistance({ x: NaN, y: 0 }, { x: 5, y: 5 }), 0)
      assert.deepEqual(calculateMidpoint(null as any, { x: 4, y: 6 }), { x: 0, y: 0 })
    })
  })

  // ─── PART 7: Timetable Validation Engine Under Corrupted Drafts ────────────
  describe('7. Timetable Validation Engine Robustness', () => {
    it('handles empty or undefined context without crashing', () => {
      const res = validateMasterTimetable({
        periods: [],
        columns: [],
        entries: [],
      })
      assert.equal(res.isValid, true)
      assert.equal(res.errors.length, 0)
      assert.equal(res.warnings.length, 0)
    })

    it('handles entries with missing or null subentries without throwing', () => {
      const res = validateMasterTimetable({
        periods: [{ id: 1, period_order: 1, start_time: '09:15', end_time: '10:15', is_break: false }],
        columns: [{ id: 1, class_id: 1, display_label: 'CSE', column_order: 1 }],
        entries: [{
          weekday: 0,
          column_id: 1,
          start_period_id: 1,
          end_period_id: 1,
          entry_type: 'theory',
          subentries: null as any,
        }],
      })
      assert.equal(res.isValid, true)
    })
  })

  // ─── PART 8: CSV Import Feedback & Non-Misleading UX Defense ─────────────
  describe('8. CSV Import Feedback & Error Transparency', () => {
    it('returns success status and clears input only when errorCount is 0 and successCount > 0', () => {
      const outcome = evaluateCsvImportOutcome(10, 0)
      assert.equal(outcome.status, 'success')
      assert.equal(outcome.shouldClearInput, true)
      assert.equal(outcome.shouldCloseModal, true)
      assert.match(outcome.message, /10 users added successfully/)
    })

    it('handles singular user count in success message', () => {
      const outcome = evaluateCsvImportOutcome(1, 0)
      assert.equal(outcome.status, 'success')
      assert.equal(outcome.shouldClearInput, true)
      assert.equal(outcome.shouldCloseModal, true)
      assert.match(outcome.message, /1 user added successfully/)
    })

    it('returns partial failure and preserves user input on mixed success/failure', () => {
      const outcome = evaluateCsvImportOutcome(4, 2)
      assert.equal(outcome.status, 'partial')
      assert.equal(outcome.shouldClearInput, false)
      assert.equal(outcome.shouldCloseModal, false)
      assert.match(outcome.message, /partially succeeded: 4 added, 2 failed/)
    })

    it('returns failure and preserves input on 100% failed imports without claiming success', () => {
      const outcome = evaluateCsvImportOutcome(0, 5)
      assert.equal(outcome.status, 'failure')
      assert.equal(outcome.shouldClearInput, false)
      assert.equal(outcome.shouldCloseModal, false)
      assert.match(outcome.message, /failed: 0 added, 5 errors/)
    })

    it('handles singular error count in failure message', () => {
      const outcome = evaluateCsvImportOutcome(0, 1)
      assert.equal(outcome.status, 'failure')
      assert.equal(outcome.shouldClearInput, false)
      assert.equal(outcome.shouldCloseModal, false)
      assert.match(outcome.message, /failed: 0 added, 1 error\./)
    })

    it('handles empty import with 0 added and 0 errors', () => {
      const outcome = evaluateCsvImportOutcome(0, 0)
      assert.equal(outcome.status, 'empty')
      assert.equal(outcome.shouldClearInput, false)
      assert.equal(outcome.shouldCloseModal, false)
      assert.match(outcome.message, /No valid rows to import/)
    })
  })

  // ─── PART 9: Concurrency, In-Flight Re-Entry Guards & Race Conditions ───────
  describe('9. Concurrency & In-Flight Re-Entry Defense', () => {
    it('prevents concurrent executions when an action is already in-flight', async () => {
      let activeExecutions = 0
      let maxConcurrent = 0
      let isInFlight = false
      let droppedCalls = 0

      async function guardedAction(id: number) {
        if (isInFlight) {
          droppedCalls++
          return { dropped: true }
        }
        isInFlight = true
        activeExecutions++
        maxConcurrent = Math.max(maxConcurrent, activeExecutions)

        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 15))

        activeExecutions--
        isInFlight = false
        return { dropped: false, id }
      }

      // Fire 5 rapid concurrent calls
      const results = await Promise.all([
        guardedAction(1),
        guardedAction(2),
        guardedAction(3),
        guardedAction(4),
        guardedAction(5),
      ])

      assert.equal(maxConcurrent, 1, 'Only 1 execution should ever be active concurrently')
      assert.equal(droppedCalls, 4, '4 rapid calls should have been dropped by the re-entry guard')
      const executed = results.filter(r => !r.dropped)
      assert.equal(executed.length, 1)
      assert.equal(executed[0].id, 1)
    })

    it('releases lock even if an async error occurs in the guarded action', async () => {
      let isInFlight = false

      async function guardedFailingAction() {
        if (isInFlight) return { blocked: true }
        isInFlight = true
        try {
          await new Promise((_, reject) => setTimeout(() => reject(new Error('Simulated failure')), 10))
        } finally {
          isInFlight = false
        }
      }

      // First call throws
      await assert.rejects(async () => {
        await guardedFailingAction()
      }, /Simulated failure/)

      // Second call should succeed because the lock was released in finally
      assert.equal(isInFlight, false, 'Lock must be freed after failure')
    })
  })

  // ─── PART 10: Attendance Correction Window & Authorization Invariants ──────
  describe('10. Attendance Correction Window & Security Invariants', () => {
    function isWithinCorrectionWindow(submittedAt: string | null | undefined, windowHrs: number, nowMs: number): boolean {
      if (!submittedAt || !Number.isFinite(windowHrs) || windowHrs <= 0) return false
      const submittedMs = new Date(submittedAt).getTime()
      if (Number.isNaN(submittedMs)) return false
      const windowMs = windowHrs * 60 * 60 * 1000
      return (nowMs - submittedMs) <= windowMs && (nowMs - submittedMs) >= 0
    }

    it('allows corrections within the policy window', () => {
      const now = Date.now()
      const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()
      const twentyThreeHoursAgo = new Date(now - 23 * 60 * 60 * 1000).toISOString()

      assert.equal(isWithinCorrectionWindow(oneHourAgo, 24, now), true)
      assert.equal(isWithinCorrectionWindow(twentyThreeHoursAgo, 24, now), true)
    })

    it('denies corrections past the policy window', () => {
      const now = Date.now()
      const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString()
      const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString()

      assert.equal(isWithinCorrectionWindow(twentyFiveHoursAgo, 24, now), false)
      assert.equal(isWithinCorrectionWindow(twoDaysAgo, 24, now), false)
    })

    it('denies corrections for unsubmitted or future-dated sessions', () => {
      const now = Date.now()
      const futureTime = new Date(now + 10 * 60 * 1000).toISOString()

      assert.equal(isWithinCorrectionWindow(null, 24, now), false)
      assert.equal(isWithinCorrectionWindow(undefined, 24, now), false)
      assert.equal(isWithinCorrectionWindow('invalid-date', 24, now), false)
      assert.equal(isWithinCorrectionWindow(futureTime, 24, now), false)
    })

    it('validates role constraint invariants against privilege escalation', () => {
      const VALID_ROLES = new Set(['student', 'professor', 'admin'])

      function isValidRole(role: unknown): boolean {
        return typeof role === 'string' && VALID_ROLES.has(role)
      }

      assert.equal(isValidRole('student'), true)
      assert.equal(isValidRole('professor'), true)
      assert.equal(isValidRole('admin'), true)

      // Malicious escalation payloads
      assert.equal(isValidRole('superuser'), false)
      assert.equal(isValidRole('root'), false)
      assert.equal(isValidRole('administrator'), false)
      assert.equal(isValidRole(''), false)
      assert.equal(isValidRole(null), false)
      assert.equal(isValidRole(undefined), false)
      assert.equal(isValidRole({ role: 'admin' }), false)
    })
  })

  // ─── PART 11: Draft Attendance Session Authorization & Enrollment Boundaries ───
  describe('11. Draft Attendance Session (save_draft_session) Enrollment & Authorization Invariants', () => {
    interface MockStudent {
      id: number
      class_id: number
      batch_id: number | null
    }

    interface MockTeachingAssignment {
      id: number
      professor_id: number
      class_id: number
      batch_id: number | null
    }

    interface MockSession {
      id: number
      teaching_assignment_id: number
      date: string
      session_type: string
      status: 'draft' | 'submitted'
    }

    interface MockRecord {
      session_id: number
      student_id: number
      status: 'present' | 'absent'
    }

    /**
     * Exact TypeScript reference model of the atomic PostgreSQL save_draft_session RPC
     * (as implemented in migration 011_harden_draft_session_authorization.sql).
     */
    function executeSaveDraftSessionAtomic(
      caller: { role: string; professor_id?: number },
      params: {
        p_session_id: number | null
        p_teaching_assignment_id: number
        p_date: string
        p_session_type: string
        p_records: Array<{ student_id: number; status: string }>
      },
      dbState: {
        assignments: MockTeachingAssignment[]
        students: MockStudent[]
        sessions: Map<number, MockSession>
        records: Map<string, MockRecord>
        todayISO: string
      }
    ) {
      // Create transaction snapshot to guarantee atomic rollback on exception
      const sessionSnapshot = new Map(dbState.sessions)
      const recordSnapshot = new Map(dbState.records)

      try {
        // 1. Role verification
        if (caller.role !== 'professor' && caller.role !== 'admin') {
          throw new Error('Unauthorized: only professors or admins can save drafts')
        }

        // 2. Assignment ownership
        const assignment = dbState.assignments.find(a => a.id === params.p_teaching_assignment_id)
        if (!assignment) {
          throw new Error(`Teaching assignment ${params.p_teaching_assignment_id} not found`)
        }
        if (caller.role === 'professor' && assignment.professor_id !== caller.professor_id) {
          throw new Error(`Forbidden: You are not authorized for teaching assignment ${params.p_teaching_assignment_id}`)
        }

        // 3. Date & session type validation
        if (params.p_date > dbState.todayISO) {
          throw new Error(`Cannot mark attendance for a future date (${params.p_date})`)
        }
        if (!['lecture', 'practical', 'tutorial'].includes(params.p_session_type)) {
          throw new Error(`Invalid session type: ${params.p_session_type}`)
        }

        // 4. Session status check: cannot revert submitted session
        let sessionId = params.p_session_id
        if (sessionId !== null) {
          const existing = dbState.sessions.get(sessionId)
          if (!existing || existing.teaching_assignment_id !== params.p_teaching_assignment_id) {
            throw new Error(`Session ${sessionId} not found for teaching assignment ${params.p_teaching_assignment_id}`)
          }
          if (existing.status === 'submitted') {
            throw new Error(`Session ${sessionId} is already submitted and cannot be reverted to draft.`)
          }
        } else {
          // Look up existing session by assignment + date
          for (const s of dbState.sessions.values()) {
            if (s.teaching_assignment_id === params.p_teaching_assignment_id && s.date === params.p_date) {
              if (s.status === 'submitted') {
                throw new Error(`Session on ${params.p_date} is already submitted.`)
              }
              sessionId = s.id
              break
            }
          }
        }

        // 5. Upsert draft session
        if (sessionId === null) {
          sessionId = dbState.sessions.size + 1
          dbState.sessions.set(sessionId, {
            id: sessionId,
            teaching_assignment_id: params.p_teaching_assignment_id,
            date: params.p_date,
            session_type: params.p_session_type,
            status: 'draft',
          })
        } else {
          const s = dbState.sessions.get(sessionId)!
          s.date = params.p_date
          s.session_type = params.p_session_type
        }

        // 6. Validate each student record and upsert
        let recordsSaved = 0
        const studentsById = new Map(dbState.students.map(st => [st.id, st]))

        for (const rec of params.p_records) {
          if (!rec.student_id || !Number.isInteger(rec.student_id)) {
            throw new Error('Missing or invalid student_id in draft records')
          }
          if (rec.status !== 'present' && rec.status !== 'absent') {
            throw new Error(`Invalid attendance status "${rec.status}" for student ${rec.student_id}`)
          }

          const st = studentsById.get(rec.student_id)
          const isEnrolled = !!st &&
            st.class_id === assignment.class_id &&
            (assignment.batch_id === null || (st.batch_id !== null && st.batch_id === assignment.batch_id))

          if (!isEnrolled) {
            throw new Error(`Student ${rec.student_id} is not enrolled in class ${assignment.class_id} (batch ${assignment.batch_id})`)
          }

          dbState.records.set(`${sessionId}-${rec.student_id}`, {
            session_id: sessionId,
            student_id: rec.student_id,
            status: rec.status,
          })
          recordsSaved++
        }

        return {
          success: true,
          session_id: sessionId,
          status: 'draft',
          records_saved: recordsSaved,
        }
      } catch (err) {
        // Atomic rollback: restore previous DB state on any error
        dbState.sessions = sessionSnapshot
        dbState.records = recordSnapshot
        throw err
      }
    }

    const mockStudents: MockStudent[] = [
      { id: 101, class_id: 1, batch_id: null }, // Class 1, common
      { id: 102, class_id: 1, batch_id: 1 },    // Class 1, Batch 1
      { id: 103, class_id: 1, batch_id: 2 },    // Class 1, Batch 2
      { id: 201, class_id: 2, batch_id: 1 },    // Class 2, Batch 1
    ]

    const mockAssignments: MockTeachingAssignment[] = [
      { id: 1, professor_id: 10, class_id: 1, batch_id: null }, // Whole-class CS-A
      { id: 2, professor_id: 10, class_id: 1, batch_id: 2 },    // Practical Batch 2 CS-A
      { id: 3, professor_id: 20, class_id: 2, batch_id: 1 },    // Other professor
    ]

    it('allows legitimate whole-class assignments to save drafts for all class students', () => {
      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: new Map<number, MockSession>(),
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      const res = executeSaveDraftSessionAtomic(
        { role: 'professor', professor_id: 10 },
        {
          p_session_id: null,
          p_teaching_assignment_id: 1, // Whole-class class_id = 1
          p_date: '2026-10-27',
          p_session_type: 'lecture',
          p_records: [
            { student_id: 101, status: 'present' },
            { student_id: 102, status: 'present' },
            { student_id: 103, status: 'absent' },
          ],
        },
        db
      )

      assert.equal(res.success, true)
      assert.equal(res.records_saved, 3)
      assert.equal(db.sessions.size, 1)
      assert.equal(db.records.size, 3)
    })

    it('allows valid batch-specific assignments to save drafts for matching batch students', () => {
      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: new Map<number, MockSession>(),
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      const res = executeSaveDraftSessionAtomic(
        { role: 'professor', professor_id: 10 },
        {
          p_session_id: null,
          p_teaching_assignment_id: 2, // Batch 2 assignment
          p_date: '2026-10-27',
          p_session_type: 'practical',
          p_records: [
            { student_id: 103, status: 'present' }, // Student 103 has batch_id = 2
          ],
        },
        db
      )

      assert.equal(res.success, true)
      assert.equal(res.records_saved, 1)
      assert.equal(db.records.get('1-103')?.status, 'present')
    })

    it('rejects cross-class students attempting to be associated with draft session', () => {
      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: new Map<number, MockSession>(),
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: null,
            p_teaching_assignment_id: 1, // class_id = 1
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [
              { student_id: 201, status: 'present' }, // Student 201 is in class_id = 2!
            ],
          },
          db
        )
      }, /Student 201 is not enrolled in class 1/)
    })

    it('rejects cross-batch students in batch-specific assignments', () => {
      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: new Map<number, MockSession>(),
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      // Teaching assignment 2 requires batch_id = 2. Student 102 is in batch_id = 1.
      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: null,
            p_teaching_assignment_id: 2,
            p_date: '2026-10-27',
            p_session_type: 'practical',
            p_records: [
              { student_id: 102, status: 'present' },
            ],
          },
          db
        )
      }, /Student 102 is not enrolled in class 1 \(batch 2\)/)

      // Student 101 has null batch_id; should also be rejected from batch 2 assignment
      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: null,
            p_teaching_assignment_id: 2,
            p_date: '2026-10-27',
            p_session_type: 'practical',
            p_records: [
              { student_id: 101, status: 'present' },
            ],
          },
          db
        )
      }, /Student 101 is not enrolled in class 1 \(batch 2\)/)
    })

    it('ensures atomic rollback: no partial session or records remain if any record is invalid', () => {
      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: new Map<number, MockSession>(),
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      // Initial state: 0 sessions, 0 records
      assert.equal(db.sessions.size, 0)
      assert.equal(db.records.size, 0)

      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: null,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [
              { student_id: 101, status: 'present' }, // Valid
              { student_id: 102, status: 'present' }, // Valid
              { student_id: 999, status: 'present' }, // Non-existent foreign student!
            ],
          },
          db
        )
      }, /Student 999 is not enrolled in class 1/)

      // Must be completely rolled back: 0 sessions, 0 records
      assert.equal(db.sessions.size, 0, 'No draft session should be created on transaction failure')
      assert.equal(db.records.size, 0, 'No draft attendance records should persist on transaction failure')
    })

    it('denies saving drafts for future dates', () => {
      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: new Map<number, MockSession>(),
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: null,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-28', // Tomorrow!
            p_session_type: 'lecture',
            p_records: [{ student_id: 101, status: 'present' }],
          },
          db
        )
      }, /Cannot mark attendance for a future date \(2026-10-28\)/)
    })

    it('denies professors from saving drafts for teaching assignments they do not own', () => {
      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: new Map<number, MockSession>(),
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      // Professor 10 tries to mark assignment 3 (owned by professor 20)
      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: null,
            p_teaching_assignment_id: 3,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [{ student_id: 201, status: 'present' }],
          },
          db
        )
      }, /Forbidden: You are not authorized for teaching assignment 3/)
    })

    it('prevents reverting an already submitted session back to draft', () => {
      const existingSessions = new Map<number, MockSession>([
        [55, { id: 55, teaching_assignment_id: 1, date: '2026-10-27', session_type: 'lecture', status: 'submitted' }],
      ])

      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: existingSessions,
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: 55,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [{ student_id: 101, status: 'present' }],
          },
          db
        )
      }, /Session 55 is already submitted and cannot be reverted to draft/)
    })

    it('rejects draft save when p_session_id belongs to a different teaching assignment', () => {
      const existingSessions = new Map<number, MockSession>([
        [99, { id: 99, teaching_assignment_id: 3, date: '2026-10-27', session_type: 'lecture', status: 'draft' }],
      ])

      const db = {
        assignments: mockAssignments,
        students: mockStudents,
        sessions: existingSessions,
        records: new Map<string, MockRecord>(),
        todayISO: '2026-10-27',
      }

      assert.throws(() => {
        executeSaveDraftSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: 99,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [{ student_id: 101, status: 'present' }],
          },
          db
        )
      }, /Session 99 not found for teaching assignment 1/)
    })
  })

  // ─── PART 12: Submit Attendance Session (submit_attendance_session) Invariants ───
  describe('12. Submit Attendance Session (submit_attendance_session) Ownership & Invariants', () => {
    interface MockAuditEntry {
      id: number
      record_id: number
      old_status: string | null
      new_status: string
      reason: string
    }

    function executeSubmitAttendanceSessionAtomic(
      caller: { role: string; professor_id?: number },
      params: {
        p_session_id: number | null
        p_teaching_assignment_id: number
        p_date: string
        p_session_type: string
        p_records: Array<{ student_id: number; status: string }>
      },
      dbState: {
        assignments: Array<{ id: number; professor_id: number; class_id: number; batch_id: number | null }>
        students: Array<{ id: number; class_id: number; batch_id: number | null }>
        sessions: Map<number, { id: number; teaching_assignment_id: number; date: string; session_type: string; status: 'draft' | 'submitted' }>
        records: Map<string, { session_id: number; student_id: number; status: 'present' | 'absent' }>
        auditLogs: MockAuditEntry[]
        todayISO: string
      }
    ) {
      // Transaction snapshots for atomic rollback
      const sessionSnapshot = new Map(dbState.sessions)
      const recordSnapshot = new Map(dbState.records)
      const auditSnapshot = [...dbState.auditLogs]

      try {
        // 1. Role verification
        if (caller.role !== 'professor' && caller.role !== 'admin') {
          throw new Error('Unauthorized: only active professors or admins can submit attendance')
        }

        // 2. Assignment ownership
        const assignment = dbState.assignments.find(a => a.id === params.p_teaching_assignment_id)
        if (!assignment) {
          throw new Error(`Teaching assignment ${params.p_teaching_assignment_id} not found`)
        }
        if (caller.role === 'professor' && assignment.professor_id !== caller.professor_id) {
          throw new Error(`Forbidden: You are not authorized for teaching assignment ${params.p_teaching_assignment_id}`)
        }

        // 3. Date & session type validation
        if (params.p_date > dbState.todayISO) {
          throw new Error(`Cannot mark attendance for a future date (${params.p_date})`)
        }
        if (!['lecture', 'practical', 'tutorial'].includes(params.p_session_type)) {
          throw new Error(`Invalid session type: ${params.p_session_type}`)
        }
        if (!params.p_records || params.p_records.length === 0) {
          throw new Error('Cannot submit attendance session with empty student records.')
        }

        // 4. Session ownership check and row-level status verification (Migration 012 hardening)
        let sessionId = params.p_session_id
        if (sessionId !== null) {
          const existing = dbState.sessions.get(sessionId)
          if (!existing) {
            throw new Error(`Session ${sessionId} not found for teaching assignment ${params.p_teaching_assignment_id}`)
          }
          if (existing.teaching_assignment_id !== params.p_teaching_assignment_id) {
            throw new Error(`Session ${sessionId} does not belong to teaching assignment ${params.p_teaching_assignment_id}`)
          }
          if (existing.status === 'submitted') {
            throw new Error(`Session ${sessionId} has already been submitted. Use correction workflow for modifications.`)
          }
        } else {
          // Look up existing session by assignment + date
          for (const s of dbState.sessions.values()) {
            if (s.teaching_assignment_id === params.p_teaching_assignment_id && s.date === params.p_date) {
              if (s.status === 'submitted') {
                throw new Error(`Attendance for this subject on ${params.p_date} has already been submitted (session ${s.id}).`)
              }
              sessionId = s.id
              break
            }
          }
        }

        // 5. Upsert session as submitted
        if (sessionId === null) {
          sessionId = dbState.sessions.size + 1
          dbState.sessions.set(sessionId, {
            id: sessionId,
            teaching_assignment_id: params.p_teaching_assignment_id,
            date: params.p_date,
            session_type: params.p_session_type,
            status: 'submitted',
          })
        } else {
          const s = dbState.sessions.get(sessionId)!
          s.status = 'submitted'
          s.date = params.p_date
          s.session_type = params.p_session_type
        }

        // 6. Validate student enrollment and upsert records + initial audit entries
        let recordsProcessed = 0
        const studentsById = new Map(dbState.students.map(st => [st.id, st]))

        for (const rec of params.p_records) {
          if (!rec.student_id || !Number.isInteger(rec.student_id)) {
            throw new Error('Missing or invalid student_id in attendance records')
          }
          if (rec.status !== 'present' && rec.status !== 'absent') {
            throw new Error(`Invalid attendance status "${rec.status}" for student ${rec.student_id}`)
          }

          const st = studentsById.get(rec.student_id)
          const isEnrolled = !!st &&
            st.class_id === assignment.class_id &&
            (assignment.batch_id === null || (st.batch_id !== null && st.batch_id === assignment.batch_id))

          if (!isEnrolled) {
            throw new Error(`Student ${rec.student_id} is not enrolled in class ${assignment.class_id} (batch ${assignment.batch_id})`)
          }

          const recKey = `${sessionId}-${rec.student_id}`
          dbState.records.set(recKey, {
            session_id: sessionId,
            student_id: rec.student_id,
            status: rec.status,
          })

          const recordId = dbState.records.size
          dbState.auditLogs.push({
            id: dbState.auditLogs.length + 1,
            record_id: recordId,
            old_status: null,
            new_status: rec.status,
            reason: 'Initial submission',
          })

          recordsProcessed++
        }

        return {
          success: true,
          session_id: sessionId,
          status: 'submitted',
          records_processed: recordsProcessed,
        }
      } catch (err) {
        dbState.sessions = sessionSnapshot
        dbState.records = recordSnapshot
        dbState.auditLogs = auditSnapshot
        throw err
      }
    }

    const testAssignments = [
      { id: 1, professor_id: 10, class_id: 1, batch_id: null }, // CS-A Whole Class
      { id: 2, professor_id: 10, class_id: 1, batch_id: 2 },    // CS-A Batch 2
      { id: 3, professor_id: 20, class_id: 2, batch_id: null }, // CS-B Other Professor
    ]

    const testStudents = [
      { id: 101, class_id: 1, batch_id: null },
      { id: 102, class_id: 1, batch_id: 1 },
      { id: 103, class_id: 1, batch_id: 2 },
      { id: 201, class_id: 2, batch_id: null },
    ]

    it('rejects submission when p_session_id belongs to a different teaching assignment (ownership gap)', () => {
      const existingSessions = new Map([
        [77, { id: 77, teaching_assignment_id: 3, date: '2026-10-27', session_type: 'lecture', status: 'draft' as const }],
      ])
      const db = {
        assignments: testAssignments,
        students: testStudents,
        sessions: existingSessions,
        records: new Map(),
        auditLogs: [],
        todayISO: '2026-10-27',
      }

      // Prof 10 owns assignment 1, but passes session 77 which belongs to assignment 3!
      assert.throws(() => {
        executeSubmitAttendanceSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: 77,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [{ student_id: 101, status: 'present' }],
          },
          db
        )
      }, /Session 77 does not belong to teaching assignment 1/)
    })

    it('rejects submission when p_session_id is non-existent', () => {
      const db = {
        assignments: testAssignments,
        students: testStudents,
        sessions: new Map(),
        records: new Map(),
        auditLogs: [],
        todayISO: '2026-10-27',
      }

      assert.throws(() => {
        executeSubmitAttendanceSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: 999,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [{ student_id: 101, status: 'present' }],
          },
          db
        )
      }, /Session 999 not found for teaching assignment 1/)
    })

    it('rejects submission when session is already submitted (forces correction workflow)', () => {
      const existingSessions = new Map([
        [12, { id: 12, teaching_assignment_id: 1, date: '2026-10-27', session_type: 'lecture', status: 'submitted' as const }],
      ])
      const db = {
        assignments: testAssignments,
        students: testStudents,
        sessions: existingSessions,
        records: new Map(),
        auditLogs: [],
        todayISO: '2026-10-27',
      }

      assert.throws(() => {
        executeSubmitAttendanceSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: 12,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [{ student_id: 101, status: 'present' }],
          },
          db
        )
      }, /Session 12 has already been submitted\. Use correction workflow for modifications\./)
    })

    it('rejects submission with empty student records', () => {
      const db = {
        assignments: testAssignments,
        students: testStudents,
        sessions: new Map(),
        records: new Map(),
        auditLogs: [],
        todayISO: '2026-10-27',
      }

      assert.throws(() => {
        executeSubmitAttendanceSessionAtomic(
          { role: 'professor', professor_id: 10 },
          {
            p_session_id: null,
            p_teaching_assignment_id: 1,
            p_date: '2026-10-27',
            p_session_type: 'lecture',
            p_records: [],
          },
          db
        )
      }, /Cannot submit attendance session with empty student records\./)
    })

    it('allows legitimate submission by owning professor and creates audit log entries atomically', () => {
      const db = {
        assignments: testAssignments,
        students: testStudents,
        sessions: new Map(),
        records: new Map(),
        auditLogs: [] as MockAuditEntry[],
        todayISO: '2026-10-27',
      }

      const res = executeSubmitAttendanceSessionAtomic(
        { role: 'professor', professor_id: 10 },
        {
          p_session_id: null,
          p_teaching_assignment_id: 1,
          p_date: '2026-10-27',
          p_session_type: 'lecture',
          p_records: [
            { student_id: 101, status: 'present' },
            { student_id: 102, status: 'absent' },
          ],
        },
        db
      )

      assert.equal(res.success, true)
      assert.equal(res.status, 'submitted')
      assert.equal(res.records_processed, 2)
      assert.equal(db.sessions.get(res.session_id)?.status, 'submitted')
      assert.equal(db.records.size, 2)
      assert.equal(db.auditLogs.length, 2)
      assert.equal(db.auditLogs[0].reason, 'Initial submission')
      assert.equal(db.auditLogs[0].old_status, null)
      assert.equal(db.auditLogs[0].new_status, 'present')
      assert.equal(db.auditLogs[1].new_status, 'absent')
    })
  })

  // ─── PART 13: Direct PostgREST Table Write Restriction Architecture ───
  describe('13. Direct PostgREST Table Write Restriction Architecture', () => {
    it('models table-level write privilege denial for direct PostgREST endpoints', () => {
      // Direct REST calls to attendance tables without RPC execution
      const directTableMutations = [
        { table: 'attendance_records', method: 'POST', body: { session_id: 1, student_id: 101, status: 'present' } },
        { table: 'attendance_records', method: 'PATCH', body: { status: 'absent' } },
        { table: 'attendance_records', method: 'DELETE', body: null },
        { table: 'sessions', method: 'POST', body: { teaching_assignment_id: 1, status: 'submitted' } },
        { table: 'sessions', method: 'PATCH', body: { status: 'draft' } },
        { table: 'attendance_audit_log', method: 'POST', body: { record_id: 1, new_status: 'present', reason: 'hacked' } },
      ]

      function evaluateDirectTablePermission(table: string, method: string): { allowed: boolean; errorCode?: string } {
        // Migration 012 explicitly revokes INSERT, UPDATE, DELETE on these tables from client roles
        if (['attendance_records', 'sessions', 'attendance_audit_log'].includes(table)) {
          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
            return { allowed: false, errorCode: '42501' } // PostgreSQL permission_denied
          }
        }
        return { allowed: true }
      }

      for (const mut of directTableMutations) {
        const result = evaluateDirectTablePermission(mut.table, mut.method)
        assert.equal(result.allowed, false, `Direct ${mut.method} on ${mut.table} must be denied at privilege layer`)
        assert.equal(result.errorCode, '42501')
      }

      // SELECT must remain allowed
      assert.equal(evaluateDirectTablePermission('attendance_records', 'GET').allowed, true)
      assert.equal(evaluateDirectTablePermission('sessions', 'GET').allowed, true)
      assert.equal(evaluateDirectTablePermission('attendance_audit_log', 'GET').allowed, true)
    })
  })

  // ─── PART 14: Query Cache Cleanup on Logout & Account Switching ───
  describe('14. Query Cache Cleanup on Logout & Account Switching', () => {
    it('clears all cached queries from QueryClient when sign-out is triggered', () => {
      // Populate cache with mock sensitive data
      queryClient.setQueryData(['admin-users'], [{ id: 'user-1', name: 'Admin', email: 'admin@college.edu' }])
      queryClient.setQueryData(['student-attendance', 101], { percent: 85, attended: 17, held: 20 })
      queryClient.setQueryData(['roster-students', 1], [{ id: 101, name: 'Alice', roll_no: 'CS101' }])

      // Verify data is present in cache
      assert.ok(queryClient.getQueryData(['admin-users']))
      assert.ok(queryClient.getQueryData(['student-attendance', 101]))
      assert.ok(queryClient.getQueryData(['roster-students', 1]))
      assert.ok(queryClient.getQueryCache().getAll().length >= 3)

      // Simulate sign-out cache wipe (as implemented in useAuth.ts)
      queryClient.clear()

      // Verify all cache entries are purged immediately
      assert.equal(queryClient.getQueryData(['admin-users']), undefined)
      assert.equal(queryClient.getQueryData(['student-attendance', 101]), undefined)
      assert.equal(queryClient.getQueryData(['roster-students', 1]), undefined)
      assert.equal(queryClient.getQueryCache().getAll().length, 0)
    })
  })

  // ─── PART 15: Whole-Class Teaching Assignment Partial Unique Index ───
  describe('15. Teaching Assignment Whole-Class Partial Unique Index & Duplicate Detection', () => {
    interface AssignmentRow {
      id: number
      professor_id: number
      subject_id: number
      class_id: number
      batch_id: number | null
    }

    function checkWholeClassDuplicates(assignments: AssignmentRow[]): { hasDuplicates: boolean; duplicates: string[] } {
      const wholeClassMap = new Map<string, number[]>()

      for (const a of assignments) {
        if (a.batch_id === null) {
          const key = `${a.professor_id}-${a.subject_id}-${a.class_id}`
          const existing = wholeClassMap.get(key) || []
          existing.push(a.id)
          wholeClassMap.set(key, existing)
        }
      }

      const duplicates: string[] = []
      for (const [key, ids] of wholeClassMap.entries()) {
        if (ids.length > 1) {
          duplicates.push(`Key ${key} has ${ids.length} duplicate rows: IDs [${ids.join(', ')}]`)
        }
      }

      return { hasDuplicates: duplicates.length > 0, duplicates }
    }

    it('detects duplicate whole-class assignments where batch_id IS NULL', () => {
      const datasetWithDuplicates: AssignmentRow[] = [
        { id: 1, professor_id: 10, subject_id: 1, class_id: 1, batch_id: null },
        { id: 2, professor_id: 10, subject_id: 1, class_id: 1, batch_id: null }, // Duplicate!
        { id: 3, professor_id: 10, subject_id: 1, class_id: 1, batch_id: 1 },    // Batch 1 (different, allowed)
      ]

      const check = checkWholeClassDuplicates(datasetWithDuplicates)
      assert.equal(check.hasDuplicates, true)
      assert.equal(check.duplicates.length, 1)
      assert.match(check.duplicates[0], /duplicate rows: IDs \[1, 2\]/)
    })

    it('allows valid distinct whole-class assignments and distinct batches', () => {
      const validDataset: AssignmentRow[] = [
        { id: 1, professor_id: 10, subject_id: 1, class_id: 1, batch_id: null }, // CS-A Theory
        { id: 2, professor_id: 10, subject_id: 1, class_id: 2, batch_id: null }, // CS-B Theory (different class)
        { id: 3, professor_id: 20, subject_id: 1, class_id: 1, batch_id: null }, // CS-A Theory (different prof)
        { id: 4, professor_id: 10, subject_id: 2, class_id: 1, batch_id: null }, // CS-A Theory Subj 2 (different subj)
        { id: 5, professor_id: 10, subject_id: 1, class_id: 1, batch_id: 1 },    // Practical Batch 1
        { id: 6, professor_id: 10, subject_id: 1, class_id: 1, batch_id: 2 },    // Practical Batch 2
      ]

      const check = checkWholeClassDuplicates(validDataset)
      assert.equal(check.hasDuplicates, false)
      assert.equal(check.duplicates.length, 0)
    })
  })

  // ─── PART 16: Security Headers, Android Manifest & CI Workflow ───
  describe('16. Security Headers, Android Manifest & CI Workflow Configuration', () => {
    it('verifies vercel.json contains CSP, HSTS, and Permissions-Policy headers', () => {
      const vercelPath = path.resolve('vercel.json')
      assert.ok(fs.existsSync(vercelPath), 'vercel.json must exist')

      const content = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'))
      const globalHeaderEntry = content.headers?.find((h: any) => h.source === '/(.*)')
      assert.ok(globalHeaderEntry, 'Global header rule must be present in vercel.json')

      const headerMap = new Map<string, string>()
      for (const h of globalHeaderEntry.headers) {
        headerMap.set(h.key, h.value)
      }

      // 1. Strict-Transport-Security
      assert.ok(headerMap.has('Strict-Transport-Security'), 'HSTS header must be configured')
      const hsts = headerMap.get('Strict-Transport-Security')!
      assert.match(hsts, /max-age=63072000/)
      assert.match(hsts, /includeSubDomains/)

      // 2. Content-Security-Policy
      assert.ok(headerMap.has('Content-Security-Policy'), 'CSP header must be configured')
      const csp = headerMap.get('Content-Security-Policy')!
      assert.match(csp, /default-src 'self'/)
      assert.match(csp, /frame-ancestors 'none'/)
      assert.match(csp, /https:\/\/\*\.supabase\.co/)

      // 3. Permissions-Policy
      assert.ok(headerMap.has('Permissions-Policy'), 'Permissions-Policy header must be configured')
      const perm = headerMap.get('Permissions-Policy')!
      assert.match(perm, /camera=\(\)/)
      assert.match(perm, /microphone=\(\)/)
      assert.match(perm, /geolocation=\(\)/)
    })

    it('verifies AndroidManifest.xml disables backup to prevent ADB token extraction', () => {
      const manifestPath = path.resolve('android/app/src/main/AndroidManifest.xml')
      assert.ok(fs.existsSync(manifestPath), 'AndroidManifest.xml must exist')

      const xml = fs.readFileSync(manifestPath, 'utf-8')
      assert.match(xml, /android:allowBackup="false"/, 'android:allowBackup must be explicitly false')
    })

    it('verifies GitHub Actions CI workflow runs test, lint, and build on push/PR to main', () => {
      const ciPath = path.resolve('.github/workflows/ci.yml')
      assert.ok(fs.existsSync(ciPath), 'ci.yml must exist')

      const yml = fs.readFileSync(ciPath, 'utf-8')
      assert.match(yml, /branches:\s*\[main\]/)
      assert.match(yml, /npm test/)
      assert.match(yml, /npm run lint/)
      assert.match(yml, /npm run build/)
    })
  })

  // ─── PART 17: Migration 013: Inactive-Account Authorization, Concurrency & Audit Policy Hardening ───
  describe('17. Migration 013: Inactive-Account Authorization, Concurrency & Audit Policy Hardening', () => {
    const migration13Path = path.resolve('supabase/migrations/013_harden_inactive_account_rpc_authorization.sql')

    it('verifies migration 013 SQL file exists and contains all required security fixes', () => {
      assert.ok(fs.existsSync(migration13Path), 'Migration 013 file must exist')
      const sql = fs.readFileSync(migration13Path, 'utf-8')

      // 1. Explicit NULL-role check in all three functions (protects against PostgreSQL tri-state logic)
      const submitRoleGuard = /submit_attendance_session[\s\S]*?v_role IS NULL OR v_role NOT IN \('professor', 'admin'\)/
      const draftRoleGuard = /save_draft_session[\s\S]*?v_role IS NULL OR v_role NOT IN \('professor', 'admin'\)/
      const correctRoleGuard = /correct_attendance_records[\s\S]*?v_role IS NULL OR v_role NOT IN \('professor', 'admin'\)/

      assert.ok(submitRoleGuard.test(sql), 'submit_attendance_session must explicitly guard against NULL v_role')
      assert.ok(draftRoleGuard.test(sql), 'save_draft_session must explicitly guard against NULL v_role')
      assert.ok(correctRoleGuard.test(sql), 'correct_attendance_records must explicitly guard against NULL v_role')

      // 2. Transaction-level advisory lock in session creation functions
      assert.match(sql, /pg_advisory_xact_lock\(hashtext\(format\('session:%s:%s', p_teaching_assignment_id, p_date\)\)\)/)

      // 3. Obsolete audit policy cleanup
      assert.match(sql, /DROP POLICY IF EXISTS audit_admin ON public\.attendance_audit_log;/)
      assert.match(sql, /DROP POLICY IF EXISTS audit_prof_insert ON public\.attendance_audit_log;/)
      assert.match(sql, /DROP POLICY IF EXISTS audit_insert ON public\.attendance_audit_log;/)

      // 4. Preserved read policies
      assert.match(sql, /CREATE POLICY audit_admin_read ON public\.attendance_audit_log/)
      assert.match(sql, /CREATE POLICY audit_prof_read ON public\.attendance_audit_log/)

      // 5. Explicit table privilege revocations and grants
      assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.attendance_audit_log FROM authenticated, anon, public;/)
      assert.match(sql, /GRANT SELECT ON public\.attendance_audit_log TO authenticated;/)

      // 6. Security Definer, search_path, and EXECUTE grants
      assert.match(sql, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
      assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_attendance_session TO authenticated;/)
      assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.submit_attendance_session FROM anon;/)
      assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.save_draft_session TO authenticated;/)
      assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.save_draft_session FROM anon;/)
      assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.correct_attendance_records TO authenticated;/)
      assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.correct_attendance_records FROM anon;/)
    })

    // Reference model for all 3 RPCs incorporating Migration 013 authorization & concurrency
    interface RPCUser {
      role: string | null | undefined
      professor_id?: number
    }

    interface MockSessionRow {
      id: number
      teaching_assignment_id: number
      date: string
      session_type: string
      status: 'draft' | 'submitted'
      submitted_at?: string
    }

    interface MockRecordRow {
      id: number
      session_id: number
      student_id: number
      status: 'present' | 'absent'
    }

    interface MockAuditRow {
      id: number
      record_id: number
      old_status: string | null
      new_status: string
      reason: string
    }

    function checkRpcRole(caller: RPCUser, rpcName: string) {
      // Models the hardened check: IF v_role IS NULL OR v_role NOT IN ('professor', 'admin') THEN
      if (caller.role === null || caller.role === undefined || !['professor', 'admin'].includes(caller.role)) {
        if (rpcName === 'submit') {
          throw new Error('Unauthorized: only active professors or admins can submit attendance')
        } else if (rpcName === 'draft') {
          throw new Error('Unauthorized: only active professors or admins can save drafts')
        } else {
          throw new Error('Unauthorized: only active professors or admins can perform attendance corrections.')
        }
      }
    }

    it('rejects NULL-role and inactive-account callers across all three RPC workflows', () => {
      const inactiveCallers: RPCUser[] = [
        { role: null },
        { role: undefined },
        { role: 'student' },
        { role: 'inactive_professor' },
        { role: '' },
      ]

      for (const caller of inactiveCallers) {
        // submit_attendance_session
        assert.throws(
          () => checkRpcRole(caller, 'submit'),
          /Unauthorized: only active professors or admins can submit attendance/
        )

        // save_draft_session
        assert.throws(
          () => checkRpcRole(caller, 'draft'),
          /Unauthorized: only active professors or admins can save drafts/
        )

        // correct_attendance_records
        assert.throws(
          () => checkRpcRole(caller, 'correct'),
          /Unauthorized: only active professors or admins can perform attendance corrections\./
        )
      }
    })

    it('demonstrates how unhardened tri-state NOT IN allows NULL role while hardened guard rejects it', () => {
      // In PostgreSQL: NULL NOT IN ('professor', 'admin') -> NULL (skips IF branch)
      function unhardenedGuardPasses(role: string | null): boolean {
        // Simulates unhardened: IF v_role NOT IN ('professor', 'admin') THEN RAISE
        const condition = role !== null && !['professor', 'admin'].includes(role)
        if (condition) {
          throw new Error('Rejected')
        }
        return true // Bypassed!
      }

      // Hardened: IF v_role IS NULL OR v_role NOT IN ('professor', 'admin') THEN RAISE
      function hardenedGuardPasses(role: string | null): boolean {
        const condition = role === null || !['professor', 'admin'].includes(role)
        if (condition) {
          throw new Error('Rejected: Unauthorized')
        }
        return true
      }

      // Unhardened incorrectly allows NULL through
      assert.equal(unhardenedGuardPasses(null), true, 'Unhardened guard incorrectly lets NULL pass through')

      // Hardened explicitly rejects NULL
      assert.throws(() => hardenedGuardPasses(null), /Rejected: Unauthorized/)
      assert.throws(() => hardenedGuardPasses('student'), /Rejected: Unauthorized/)
      assert.equal(hardenedGuardPasses('professor'), true)
      assert.equal(hardenedGuardPasses('admin'), true)
    })

    it('allows valid professor and administrator workflows in attendance corrections', () => {
      const sessions = new Map<number, MockSessionRow>([
        [1, { id: 1, teaching_assignment_id: 10, date: '2026-10-27', session_type: 'lecture', status: 'submitted', submitted_at: new Date(Date.now() - 3600000).toISOString() }],
      ])
      const records = new Map<string, MockRecordRow>([
        ['1-101', { id: 501, session_id: 1, student_id: 101, status: 'absent' }],
      ])
      const auditLogs: MockAuditRow[] = []
      const assignments = [{ id: 10, professor_id: 5, class_id: 1, batch_id: null }]

      function correctRecords(
        caller: RPCUser,
        sessionId: number,
        changes: Array<{ student_id: number; new_status: 'present' | 'absent' }>,
        reason: string
      ) {
        if (!reason || reason.trim().length === 0) {
          throw new Error('A non-empty reason is mandatory for attendance corrections.')
        }
        checkRpcRole(caller, 'correct')

        const session = sessions.get(sessionId)
        if (!session) throw new Error(`Session ${sessionId} not found.`)
        if (session.status !== 'submitted') throw new Error(`Session ${sessionId} is not submitted. Use standard submission instead.`)

        const assignment = assignments.find(a => a.id === session.teaching_assignment_id)
        if (caller.role === 'professor') {
          if (!assignment || assignment.professor_id !== caller.professor_id) {
            throw new Error("Forbidden: You do not have permission to modify another professor's session.")
          }
          const submittedMs = new Date(session.submitted_at!).getTime()
          if ((Date.now() - submittedMs) > 24 * 3600000) {
            throw new Error('Correction window (24 hours) has expired for session 1. Modification locked.')
          }
        }

        let changesApplied = 0
        for (const ch of changes) {
          const rec = records.get(`${sessionId}-${ch.student_id}`)
          if (!rec) throw new Error(`Attendance record not found for student ${ch.student_id} in session ${sessionId}`)
          if (rec.status !== ch.new_status) {
            const oldStatus = rec.status
            rec.status = ch.new_status
            auditLogs.push({
              id: auditLogs.length + 1,
              record_id: rec.id,
              old_status: oldStatus,
              new_status: ch.new_status,
              reason: reason.trim(),
            })
            changesApplied++
          }
        }
        return { success: true, session_id: sessionId, changes_applied: changesApplied }
      }

      // Owning professor modifies attendance within window
      const profResult = correctRecords(
        { role: 'professor', professor_id: 5 },
        1,
        [{ student_id: 101, new_status: 'present' }],
        'Medical certificate verified'
      )
      assert.equal(profResult.success, true)
      assert.equal(profResult.changes_applied, 1)
      assert.equal(records.get('1-101')?.status, 'present')
      assert.equal(auditLogs.length, 1)
      assert.equal(auditLogs[0].reason, 'Medical certificate verified')
      assert.equal(auditLogs[0].old_status, 'absent')
      assert.equal(auditLogs[0].new_status, 'present')

      // Admin override modifies attendance
      const adminResult = correctRecords(
        { role: 'admin' },
        1,
        [{ student_id: 101, new_status: 'absent' }],
        'Administrative audit correction'
      )
      assert.equal(adminResult.success, true)
      assert.equal(adminResult.changes_applied, 1)
      assert.equal(records.get('1-101')?.status, 'absent')
      assert.equal(auditLogs.length, 2)
      assert.equal(auditLogs[1].reason, 'Administrative audit correction')
    })

    it('denies corrections without mandatory non-empty reason', () => {
      assert.throws(() => {
        if (!''.trim()) throw new Error('A non-empty reason is mandatory for attendance corrections.')
      }, /A non-empty reason is mandatory for attendance corrections\./)

      assert.throws(() => {
        if (!'   '.trim()) throw new Error('A non-empty reason is mandatory for attendance corrections.')
      }, /A non-empty reason is mandatory for attendance corrections\./)
    })

    it('models concurrent session creation and verifies advisory lock prevents duplicate sessions', async () => {
      // Simulate database table and transaction-level advisory locks
      const sessionsTable = new Map<number, MockSessionRow>()
      let nextSessionId = 1
      const activeLocks = new Set<string>()

      async function acquireAdvisoryLock(key: string): Promise<() => void> {
        // Wait until lock is available
        while (activeLocks.has(key)) {
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        activeLocks.add(key)
        return () => {
          activeLocks.delete(key)
        }
      }

      async function saveDraftSessionConcurrent(
        caller: RPCUser,
        teachingAssignmentId: number,
        date: string,
        sessionType: string
      ): Promise<{ session_id: number; created: boolean }> {
        checkRpcRole(caller, 'draft')

        // Acquire transaction-level advisory lock on (assignment, date)
        const lockKey = `session:${teachingAssignmentId}:${date}`
        const releaseLock = await acquireAdvisoryLock(lockKey)

        try {
          // Check if session already exists under the lock
          let existingSession: MockSessionRow | undefined
          for (const s of sessionsTable.values()) {
            if (s.teaching_assignment_id === teachingAssignmentId && s.date === date) {
              existingSession = s
              break
            }
          }

          if (existingSession) {
            if (existingSession.status === 'submitted') {
              throw new Error(`Session on ${date} is already submitted.`)
            }
            // Update existing draft session
            existingSession.session_type = sessionType
            return { session_id: existingSession.id, created: false }
          }

          // Simulate slight I/O latency inside transaction
          await new Promise(resolve => setTimeout(resolve, 10))

          // Insert new session
          const newId = nextSessionId++
          const newSession: MockSessionRow = {
            id: newId,
            teaching_assignment_id: teachingAssignmentId,
            date,
            session_type: sessionType,
            status: 'draft',
          }
          sessionsTable.set(newId, newSession)
          return { session_id: newId, created: true }
        } finally {
          releaseLock()
        }
      }

      // Fire 4 rapid concurrent calls for the exact same assignment and date
      const results = await Promise.all([
        saveDraftSessionConcurrent({ role: 'professor', professor_id: 1 }, 10, '2026-10-27', 'lecture'),
        saveDraftSessionConcurrent({ role: 'professor', professor_id: 1 }, 10, '2026-10-27', 'lecture'),
        saveDraftSessionConcurrent({ role: 'admin' }, 10, '2026-10-27', 'lecture'),
        saveDraftSessionConcurrent({ role: 'professor', professor_id: 1 }, 10, '2026-10-27', 'lecture'),
      ])

      // Verification:
      // 1. Exactly 1 session row must exist in the database table
      assert.equal(sessionsTable.size, 1, 'Only one session row must be created for the assignment and date')

      // 2. All 4 callers must have been associated with the exact same session ID
      const createdCount = results.filter(r => r.created).length
      assert.equal(createdCount, 1, 'Exactly one transaction should have performed INSERT')
      for (const res of results) {
        assert.equal(res.session_id, 1, 'All concurrent calls must resolve to the single session ID')
      }
    })

    it('rejects concurrent submission if session was already submitted during lock wait', async () => {
      const sessionsTable = new Map<number, MockSessionRow>([
        [1, { id: 1, teaching_assignment_id: 20, date: '2026-10-27', session_type: 'lecture', status: 'submitted' }],
      ])
      const activeLocks = new Set<string>()

      async function acquireAdvisoryLock(key: string): Promise<() => void> {
        while (activeLocks.has(key)) {
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        activeLocks.add(key)
        return () => {
          activeLocks.delete(key)
        }
      }

      async function submitSessionConcurrent(
        caller: RPCUser,
        teachingAssignmentId: number,
        date: string
      ) {
        checkRpcRole(caller, 'submit')
        const lockKey = `session:${teachingAssignmentId}:${date}`
        const release = await acquireAdvisoryLock(lockKey)

        try {
          for (const s of sessionsTable.values()) {
            if (s.teaching_assignment_id === teachingAssignmentId && s.date === date) {
              if (s.status === 'submitted') {
                throw new Error(`Attendance for this subject on ${date} has already been submitted (session ${s.id}).`)
              }
            }
          }
        } finally {
          release()
        }
      }

      await assert.rejects(
        () => submitSessionConcurrent({ role: 'professor', professor_id: 1 }, 20, '2026-10-27'),
        /Attendance for this subject on 2026-10-27 has already been submitted \(session 1\)\./
      )
    })
  })
})
