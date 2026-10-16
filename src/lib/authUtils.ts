/**
 * Centralized authentication, validation, and error diagnostic utilities.
 */

export interface ValidationResult {
  isValid: boolean
  error?: string
}

export type PortalType = 'student' | 'staff'

export interface PortalValidationResult {
  allowed: boolean
  error?: string
  suggestedPortal?: PortalType
  redirectPath?: string
}

/**
 * Validates whether the authenticated profile role is authorized to enter the selected portal.
 * - 'student' portal -> allows 'student' role only.
 * - 'staff' portal   -> allows 'professor' and 'admin' roles only.
 * Checks for missing profile, inactive account, and role mismatch.
 */
export function validatePortalAccess(
  portal: PortalType,
  profile: { role?: string; is_active?: boolean } | null | undefined
): PortalValidationResult {
  if (!profile) {
    return {
      allowed: false,
      error: 'Account profile not found. Please contact your college administrator or register as a student.',
    }
  }

  if (profile.is_active === false) {
    return {
      allowed: false,
      error: 'Your account has been deactivated. Please contact your college administrator.',
    }
  }

  const role = profile.role

  if (portal === 'staff') {
    if (role === 'student') {
      return {
        allowed: false,
        suggestedPortal: 'student',
        error: 'This account is registered as a student. Please use the Student portal.',
      }
    }
    if (role === 'professor') {
      return {
        allowed: true,
        redirectPath: '/professor',
      }
    }
    if (role === 'admin') {
      return {
        allowed: true,
        redirectPath: '/admin',
      }
    }
    return {
      allowed: false,
      error: `Unauthorized role (${role}) for Staff / Faculty portal.`,
    }
  }

  if (portal === 'student') {
    if (role === 'professor' || role === 'admin') {
      return {
        allowed: false,
        suggestedPortal: 'staff',
        error: 'This account belongs to the Staff & Faculty portal. Please switch to the Staff portal.',
      }
    }
    if (role === 'student') {
      return {
        allowed: true,
        redirectPath: '/student',
      }
    }
    return {
      allowed: false,
      error: `Unauthorized role (${role}) for Student portal.`,
    }
  }

  return {
    allowed: false,
    error: 'Invalid portal selection.',
  }
}

/**
 * Normalizes an email address consistently:
 * - Strips zero-width spaces (\u200B-\u200D\uFEFF) frequently inserted by mobile keyboards
 * - Trims leading and trailing whitespace
 * - Converts to lowercase
 */
export function normalizeEmail(email: string): string {
  if (!email) return ''
  return email
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '') // remove zero-width & non-breaking spaces
    .trim()
    .toLowerCase()
}

/**
 * Standard RFC 5322 permissive email validator.
 * Rejects empty values and malformed addresses without artificially restricting valid domains (such as @gmail.com).
 */
export function validateEmail(email: string): ValidationResult {
  const normalized = normalizeEmail(email)

  if (!normalized) {
    return { isValid: false, error: 'Email address cannot be empty.' }
  }

  // Reject internal spaces
  if (/\s/.test(normalized)) {
    return { isValid: false, error: 'Email address cannot contain spaces.' }
  }

  // Permissive RFC 5322 regex check
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
  if (!emailRegex.test(normalized)) {
    return { isValid: false, error: 'Please enter a valid email address (e.g. name@gmail.com).' }
  }

  // Verify domain has valid structure
  const parts = normalized.split('@')
  if (parts.length !== 2 || !parts[1].includes('.')) {
    return { isValid: false, error: 'Email domain is missing a top-level domain.' }
  }

  const domain = parts[1]
  const tld = domain.split('.').pop()
  if (!tld || tld.length < 2) {
    return { isValid: false, error: 'Email domain extension is too short.' }
  }

  return { isValid: true }
}

/**
 * Validates password strength according to Supabase Auth policy:
 * - Does NOT alter, trim, or lowercase password characters
 * - Ensures minimum length (default 6 characters)
 */
export function validatePassword(password: string): ValidationResult {
  if (!password) {
    return { isValid: false, error: 'Password cannot be empty.' }
  }
  if (password.length < 6) {
    return { isValid: false, error: 'Password must be at least 6 characters long.' }
  }
  return { isValid: true }
}

/**
 * Distinguishes authentication errors into actionable, user-friendly messages
 * with diagnostic logging in non-production environments.
 */
export function formatAuthError(error: any): string {
  if (!error) return 'An unknown authentication error occurred.'

  const code = (error.code || error.error_code || '').toLowerCase()
  const msg = (error.message || error.msg || String(error)).toLowerCase()
  const status = error.status

  // Safe developer diagnostic log (never prints passwords or keys)
  const isDev =
    (typeof (globalThis as any).process !== 'undefined' &&
      (globalThis as any).process.env?.NODE_ENV !== 'production') ||
    Boolean((import.meta as any)?.env?.DEV)

  if (isDev) {
    try {
      console.debug('[Auth Diagnostic]', {
        code,
        status,
        message: error.message,
      })
    } catch {
      // Ignore console logging errors in test runners
    }
  }

  // 1. Email invalid / rejected by server
  if (code === 'email_address_invalid' || msg.includes('email address') && msg.includes('is invalid')) {
    return 'The server rejected this email format. Please check for accidental typos or invalid characters.'
  }

  // 2. Email Rate limit (Supabase default mailer hit)
  if (code === 'over_email_send_rate_limit' || msg.includes('rate limit')) {
    return 'Email delivery rate limit reached. Supabase default mailer has a strict hourly quota. Please wait a few minutes, or disable "Confirm email" in the Supabase Dashboard.'
  }

  // 3. Database trigger error
  if (msg.includes('database error creating new user') || msg.includes('relation "profiles" does not exist') || code === 'unexpected_failure') {
    return 'Database error setting up user profile. Please ensure SQL migration 004 has been executed in your Supabase SQL Editor.'
  }

  // 4. Invalid credentials
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'Incorrect email or password. Please verify your details.'
  }

  // 5. Unconfirmed email
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Please verify your email address before signing in. Check your inbox (or spam folder) for the verification link.'
  }

  // 6. User already registered
  if (code === 'user_already_exists' || msg.includes('already registered') || msg.includes('already exists')) {
    return 'An account with this email address already exists. Please switch to Sign In.'
  }

  // 7. Password policy failure
  if (msg.includes('password should be at least')) {
    return 'Password is too short. It must be at least 6 characters long.'
  }

  // 8. Offline / Network error
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || !navigator.onLine) {
    return 'Unable to reach the server. Please check your internet connection or verify the server is reachable.'
  }

  return error.message || 'Authentication failed. Please try again.'
}
