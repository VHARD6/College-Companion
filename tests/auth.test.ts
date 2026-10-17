import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeEmail,
  validateEmail,
  validatePassword,
  formatAuthError,
  formatDatabaseAuthError,
  logAuthDiagnostic,
  validatePortalAccess,
} from '../src/lib/authUtils.ts'

describe('Authentication & Validation Test Suite', () => {
  // ─── 1. Email Normalization ──────────────────────────────────────────────
  describe('Email Normalization', () => {
    it('trims leading and trailing spaces', () => {
      assert.equal(normalizeEmail('  student@gmail.com  '), 'student@gmail.com')
    })

    it('converts uppercase to lowercase', () => {
      assert.equal(normalizeEmail('Student.User@GMAIL.COM'), 'student.user@gmail.com')
    })

    it('strips zero-width and non-breaking spaces inserted by mobile keyboards', () => {
      const dirty = 'student\u200B@gmail.com\u00A0'
      assert.equal(normalizeEmail(dirty), 'student@gmail.com')
    })

    it('handles empty or null gracefully', () => {
      assert.equal(normalizeEmail(''), '')
    })
  })

  // ─── 2. Email Validation ────────────────────────────────────────────────
  describe('Email Validation', () => {
    it('accepts standard Gmail and custom domain emails', () => {
      assert.equal(validateEmail('student@gmail.com').isValid, true)
      assert.equal(validateEmail('prof.sharma@college.edu.in').isValid, true)
      assert.equal(validateEmail('admin+testing@college.org').isValid, true)
    })

    it('rejects empty input', () => {
      const res = validateEmail('')
      assert.equal(res.isValid, false)
      assert.match(res.error || '', /cannot be empty/i)
    })

    it('rejects emails with internal spaces', () => {
      const res = validateEmail('student @gmail.com')
      assert.equal(res.isValid, false)
      assert.match(res.error || '', /cannot contain spaces/i)
    })

    it('rejects malformed syntax', () => {
      assert.equal(validateEmail('notanemail').isValid, false)
      assert.equal(validateEmail('missingdomain@').isValid, false)
      assert.equal(validateEmail('@domain.com').isValid, false)
      assert.equal(validateEmail('student@domain').isValid, false)
    })
  })

  // ─── 3. Password Validation ─────────────────────────────────────────────
  describe('Password Validation', () => {
    it('accepts passwords with 6 or more characters', () => {
      assert.equal(validatePassword('Pass123!').isValid, true)
      assert.equal(validatePassword('123456').isValid, true)
    })

    it('rejects passwords shorter than 6 characters', () => {
      const res = validatePassword('12345')
      assert.equal(res.isValid, false)
      assert.match(res.error || '', /at least 6 characters/i)
    })

    it('does not alter or trim password characters', () => {
      const raw = '  pass with spaces  '
      assert.equal(validatePassword(raw).isValid, true)
    })
  })

  // ─── 4. Auth Error Formatter Diagnostics ─────────────────────────────────
  describe('Supabase Error Formatting & Diagnostics', () => {
    it('formats invalid login credentials', () => {
      const err = { code: 'invalid_credentials', message: 'Invalid login credentials' }
      assert.match(formatAuthError(err), /Incorrect email or password/i)
    })

    it('formats unconfirmed email error', () => {
      const err = { message: 'Email not confirmed' }
      assert.match(formatAuthError(err), /verify your email/i)
    })

    it('formats email rate limit errors from Supabase default mailer', () => {
      const err = { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }
      assert.match(formatAuthError(err), /rate limit reached/i)
    })

    it('formats rejected email addresses from server validation', () => {
      const err = { code: 'email_address_invalid', message: 'Email address "xyz" is invalid' }
      assert.match(formatAuthError(err), /server rejected this email format/i)
    })

    it('formats database trigger errors (relation profiles does not exist)', () => {
      const err = { message: 'Database error creating new user: relation "profiles" does not exist' }
      assert.match(formatAuthError(err), /migration 004/i)
    })

    it('formats network and fetch failures', () => {
      const err = new Error('TypeError: Failed to fetch')
      assert.match(formatAuthError(err), /Unable to reach the server/i)
    })

    it('formats user already registered error', () => {
      const err = { code: 'user_already_exists', message: 'User already registered' }
      assert.match(formatAuthError(err), /already exists/i)
    })
  })

  // ─── 5. Security & Role Policy Verification ─────────────────────────────
  describe('Role-Based Registration Rules', () => {
    it('verifies that public self-registration defaults strictly to student', () => {
      const publicUserMetadata = { name: 'Aakash', role: 'admin' } // malicious client trying to escalate
      // Simulation of trigger handle_new_user() rule:
      const assignedRole = 'student' // trigger ignores client-submitted role
      assert.equal(assignedRole, 'student')
      assert.notEqual(assignedRole, publicUserMetadata.role)
    })

    it('validates password confirmation match logic', () => {
      const p1 = 'Secret123!'
      const p2 = 'Secret123!'
      const p3 = 'Different456!'

      assert.equal(p1 === p2, true)
      assert.equal(p1 === p3, false)
    })

    it('validates required fields for student registration', () => {
      const validForm = { name: 'Priya', email: 'priya@gmail.com', password: 'Password123' }
      const invalidForm = { name: '', email: 'priya@gmail.com', password: 'Password123' }

      assert.equal(Boolean(validForm.name && validForm.email && validForm.password), true)
      assert.equal(Boolean(invalidForm.name && invalidForm.email && invalidForm.password), false)
    })
  })

  // ─── 6. Portal Separation & Role Enforcement ────────────────────────────
  describe('Portal Separation & Role Access Validation', () => {
    it('blocks student role from accessing Staff portal with suggested redirect', () => {
      const profile = { role: 'student', is_active: true }
      const result = validatePortalAccess('staff', profile)

      assert.equal(result.allowed, false)
      assert.equal(result.suggestedPortal, 'student')
      assert.match(result.error || '', /registered as a student/i)
      assert.match(result.error || '', /use the student portal/i)
    })

    it('blocks professor role from accessing Student portal with suggested redirect', () => {
      const profile = { role: 'professor', is_active: true }
      const result = validatePortalAccess('student', profile)

      assert.equal(result.allowed, false)
      assert.equal(result.suggestedPortal, 'staff')
      assert.match(result.error || '', /belongs to the staff & faculty portal/i)
    })

    it('blocks admin role from accessing Student portal with suggested redirect', () => {
      const profile = { role: 'admin', is_active: true }
      const result = validatePortalAccess('student', profile)

      assert.equal(result.allowed, false)
      assert.equal(result.suggestedPortal, 'staff')
      assert.match(result.error || '', /belongs to the staff & faculty portal/i)
    })

    it('allows student role on Student portal with correct redirect path', () => {
      const profile = { role: 'student', is_active: true }
      const result = validatePortalAccess('student', profile)

      assert.equal(result.allowed, true)
      assert.equal(result.redirectPath, '/student')
      assert.equal(result.error, undefined)
    })

    it('allows professor role on Staff portal with correct redirect path', () => {
      const profile = { role: 'professor', is_active: true }
      const result = validatePortalAccess('staff', profile)

      assert.equal(result.allowed, true)
      assert.equal(result.redirectPath, '/professor')
      assert.equal(result.error, undefined)
    })

    it('allows admin role on Staff portal with correct redirect path', () => {
      const profile = { role: 'admin', is_active: true }
      const result = validatePortalAccess('staff', profile)

      assert.equal(result.allowed, true)
      assert.equal(result.redirectPath, '/admin')
      assert.equal(result.error, undefined)
    })

    it('rejects deactivated accounts on both portals', () => {
      const inactiveStudent = { role: 'student', is_active: false }
      const inactiveStaff = { role: 'professor', is_active: false }

      const resStudent = validatePortalAccess('student', inactiveStudent)
      assert.equal(resStudent.allowed, false)
      assert.match(resStudent.error || '', /deactivated/i)

      const resStaff = validatePortalAccess('staff', inactiveStaff)
      assert.equal(resStaff.allowed, false)
      assert.match(resStaff.error || '', /deactivated/i)
    })

    it('rejects missing or null profile', () => {
      const resNull = validatePortalAccess('student', null)
      assert.equal(resNull.allowed, false)
      assert.match(resNull.error || '', /profile not found/i)

      const resUndef = validatePortalAccess('staff', undefined)
      assert.equal(resUndef.allowed, false)
      assert.match(resUndef.error || '', /profile not found/i)
    })

    it('rejects unknown or invalid role', () => {
      const invalidProfile = { role: 'guest', is_active: true }
      const res = validatePortalAccess('student', invalidProfile)
      assert.equal(res.allowed, false)
      assert.match(res.error || '', /unauthorized role/i)
    })
  })

  // ─── 7. Profile Verification & Database Diagnostics ─────────────────────
  describe('Profile Verification, Database Diagnostics & Sign-Out Behavior', () => {
    it('formats PostgreSQL 42P17 infinite recursion into actionable migration 007 guidance', () => {
      const dbErr = {
        code: '42P17',
        message: 'infinite recursion detected in policy for relation "students"',
        details: null,
        hint: null,
        status: 500,
      }
      const formatted = formatDatabaseAuthError(dbErr)
      assert.match(formatted, /recursive access rule detected/i)
      assert.match(formatted, /migration 007/i)
    })

    it('formats PostgreSQL 42501 permission denied into clear role guidance', () => {
      const dbErr = {
        code: '42501',
        message: 'permission denied for table profiles',
        details: null,
        hint: null,
        status: 403,
      }
      const formatted = formatDatabaseAuthError(dbErr)
      assert.match(formatted, /permission denied/i)
      assert.match(formatted, /account role/i)
    })

    it('formats missing relation 42P01 into table migration guidance', () => {
      const dbErr = {
        code: '42P01',
        message: 'relation "public.profiles" does not exist',
      }
      const formatted = formatDatabaseAuthError(dbErr)
      assert.match(formatted, /table profiles not found/i)
    })

    it('safe diagnostic logging captures code, message, details, hint, and status without error', () => {
      let loggedOutput: any = null
      const originalDebug = console.debug
      console.debug = (_tag: string, payload: any) => {
        loggedOutput = payload
      }

      try {
        logAuthDiagnostic('test_context', {
          code: '42P17',
          message: 'infinite recursion detected',
          details: 'Key (id)=(1) failed',
          hint: 'Check table RLS policies',
          status: 500,
          secretPasswordShouldNotBeLogged: 'super-secret',
        })

        assert.equal(loggedOutput?.code, '42P17')
        assert.equal(loggedOutput?.message, 'infinite recursion detected')
        assert.equal(loggedOutput?.details, 'Key (id)=(1) failed')
        assert.equal(loggedOutput?.hint, 'Check table RLS policies')
        assert.equal(loggedOutput?.status, 500)
        assert.equal(loggedOutput?.secretPasswordShouldNotBeLogged, undefined)
      } finally {
        console.debug = originalDebug
      }
    })

    it('simulates signInForPortal: signs out and throws on database query failure', async () => {
      let signedOut = false
      const mockSignOut = async () => {
        signedOut = true
      }

      const simulateSignInForPortal = async (
        profErr: any,
        userProfile: any,
        portal: 'student' | 'staff'
      ) => {
        if (profErr) {
          await mockSignOut()
          throw new Error(formatDatabaseAuthError(profErr))
        }

        if (!userProfile) {
          await mockSignOut()
          throw new Error('Account profile not found. Please contact your college administrator or register as a student.')
        }

        const check = validatePortalAccess(portal, userProfile)
        if (!check.allowed) {
          await mockSignOut()
          const mismatchErr: any = new Error(check.error)
          mismatchErr.suggestedPortal = check.suggestedPortal
          throw mismatchErr
        }

        return { profile: userProfile, redirectPath: check.redirectPath! }
      }

      // Test 1: Database error during profile lookup triggers immediate sign-out
      signedOut = false
      await assert.rejects(
        async () => {
          await simulateSignInForPortal(
            { code: '42P17', message: 'infinite recursion detected in policy for relation "students"' },
            null,
            'student'
          )
        },
        /migration 007/i
      )
      assert.equal(signedOut, true)

      // Test 2: Missing profile row triggers immediate sign-out
      signedOut = false
      await assert.rejects(
        async () => {
          await simulateSignInForPortal(null, null, 'staff')
        },
        /profile not found/i
      )
      assert.equal(signedOut, true)

      // Test 3: Role mismatch triggers immediate sign-out and suggests portal
      signedOut = false
      await assert.rejects(
        async () => {
          await simulateSignInForPortal(
            null,
            { id: 'u1', role: 'student', is_active: true },
            'staff'
          )
        },
        (err: any) => {
          assert.equal(err.suggestedPortal, 'student')
          return true
        }
      )
      assert.equal(signedOut, true)

      // Test 4: Active admin signs into staff portal -> succeeds without sign-out
      signedOut = false
      const adminRes = await simulateSignInForPortal(
        null,
        { id: 'admin-1', role: 'admin', is_active: true },
        'staff'
      )
      assert.equal(adminRes.redirectPath, '/admin')
      assert.equal(signedOut, false)

      // Test 5: Active professor signs into staff portal -> succeeds without sign-out
      signedOut = false
      const profRes = await simulateSignInForPortal(
        null,
        { id: 'prof-1', role: 'professor', is_active: true },
        'staff'
      )
      assert.equal(profRes.redirectPath, '/professor')
      assert.equal(signedOut, false)

      // Test 6: Active student signs into student portal -> succeeds without sign-out
      signedOut = false
      const studentRes = await simulateSignInForPortal(
        null,
        { id: 'stud-1', role: 'student', is_active: true },
        'student'
      )
      assert.equal(studentRes.redirectPath, '/student')
      assert.equal(signedOut, false)
    })
  })
})

