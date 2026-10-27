import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
})



