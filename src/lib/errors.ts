export type ErrorCategory =
  | 'network'
  | 'auth_expired'
  | 'permission_denied'
  | 'validation'
  | 'server_error'
  | 'unknown'

export type ErrorAction = 'retry' | 'sign_in' | 'none'

export interface ClassifiedError {
  category: ErrorCategory
  userMessage: string
  action: ErrorAction
}

/**
 * Classifies an unknown error into a stable, safe category with fixed user-facing copy.
 * This is a pure function with no side effects (no logging, no mutations).
 *
 * Safety requirements:
 * 1. Classifies by structured HTTP status or known error code FIRST.
 * 2. Uses text matching ONLY as a fallback when structured info is absent or insufficient.
 * 3. Never loosely matches bare numbers like "500" (e.g. "500 students processed", "500 records found", "ID 503").
 * 4. Text fallback requires explicit HTTP status context (e.g. "HTTP 503", "status: 503") or server error wording.
 * 5. Auth expired returns action: 'sign_in'.
 * 6. Permission and validation errors return action: 'none'.
 * 7. Never leaks database internals, table names, RLS policy text, SQL, or JWT strings.
 */
export function classifyAttendanceError(error: unknown): ClassifiedError {
  if (!error) {
    return {
      category: 'unknown',
      userMessage: 'Something went wrong while loading attendance. Please try again.',
      action: 'retry',
    }
  }

  // ─── Step 1: Extract structured fields ─────────────────────────────
  let status: number | null = null
  let code: string | null = null
  let rawMessage = ''

  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>

    if (typeof errObj.status === 'number') {
      status = errObj.status
    } else if (typeof errObj.status === 'string' && /^\d{3}$/.test(errObj.status)) {
      status = parseInt(errObj.status, 10)
    }

    if (typeof errObj.code === 'string') {
      code = errObj.code
    } else if (typeof errObj.code === 'number') {
      code = String(errObj.code)
    }

    if (typeof errObj.message === 'string') {
      rawMessage = errObj.message
    }
  } else if (typeof error === 'string') {
    rawMessage = error
  }

  // ─── Step 2: Classify by structured HTTP status or known code FIRST ─
  // Authentication / JWT expiry
  if (
    status === 401 ||
    code === 'PGRST301' ||
    code === 'invalid_jwt' ||
    code === 'token_expired' ||
    code === 'jwt_expired'
  ) {
    return {
      category: 'auth_expired',
      userMessage: 'Your sign-in session has expired. Please sign in again.',
      action: 'sign_in',
    }
  }

  // Permission / Authorization
  if (
    status === 403 ||
    code === '42501' || // PostgreSQL: insufficient_privilege
    code === 'PGRST302'
  ) {
    return {
      category: 'permission_denied',
      userMessage: 'You do not have permission to perform this action.',
      action: 'none',
    }
  }

  // Validation / Invalid input
  if (
    status === 400 ||
    status === 422 ||
    code === '23502' || // not_null_violation
    code === '23503' || // foreign_key_violation
    code === '23514' || // check_violation
    code === 'PGRST100'
  ) {
    return {
      category: 'validation',
      userMessage: 'Some details need checking. Review the attendance information and try again.',
      action: 'none',
    }
  }

  // Temporary server failure
  if (
    (status !== null && status >= 500 && status <= 599) ||
    code === '57014' || // query_canceled
    code === 'XX000' || // internal_error
    code === '53300'    // too_many_connections
  ) {
    return {
      category: 'server_error',
      userMessage: 'The server is temporarily unavailable. Please try again shortly.',
      action: 'retry',
    }
  }

  // Network / connection error codes
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'FETCH_ERROR' ||
    code === 'NETWORK_ERROR'
  ) {
    return {
      category: 'network',
      userMessage: 'Unable to reach the server. Check your connection and try again.',
      action: 'retry',
    }
  }

  // ─── Step 3: Text matching ONLY as a fallback ───────────────────────
  const lowerMsg = rawMessage.toLowerCase()

  // Network text fallback
  if (
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('networkerror') ||
    lowerMsg.includes('network request failed') ||
    lowerMsg.includes('load failed') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('net::err')
  ) {
    return {
      category: 'network',
      userMessage: 'Unable to reach the server. Check your connection and try again.',
      action: 'retry',
    }
  }

  // Auth expired text fallback
  if (
    lowerMsg.includes('jwt expired') ||
    lowerMsg.includes('token expired') ||
    lowerMsg.includes('session expired') ||
    lowerMsg.includes('invalid claim')
  ) {
    return {
      category: 'auth_expired',
      userMessage: 'Your sign-in session has expired. Please sign in again.',
      action: 'sign_in',
    }
  }

  // Permission text fallback
  if (
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('violates row-level security') ||
    lowerMsg.includes('not authorized') ||
    lowerMsg.includes('forbidden')
  ) {
    return {
      category: 'permission_denied',
      userMessage: 'You do not have permission to perform this action.',
      action: 'none',
    }
  }

  // Validation text fallback
  if (
    lowerMsg.includes('mandatory reason') ||
    lowerMsg.includes('reason is required') ||
    lowerMsg.includes('invalid status') ||
    lowerMsg.includes('invalid session type') ||
    lowerMsg.includes('cannot mark attendance for a future date') ||
    lowerMsg.includes('student is not enrolled')
  ) {
    return {
      category: 'validation',
      userMessage: 'Some details need checking. Review the attendance information and try again.',
      action: 'none',
    }
  }

  // Server error text fallback
  // CRITICAL: Must require explicit HTTP-status context (e.g. "HTTP 503", "status: 503")
  // or clear server-error wording. NEVER classify a message merely because it contains a number
  // equal to an HTTP status (e.g. "500 students processed", "500 records found", "ID 503").
  if (
    /\b(?:https?(?:\/\d(?:\.\d)?)?(?:\s+status(?:\s+code)?)?|status(?:\s*code)?:?)\s*50[0-9]\b/i.test(rawMessage) ||
    lowerMsg.includes('internal server error') ||
    lowerMsg.includes('service unavailable') ||
    lowerMsg.includes('bad gateway') ||
    lowerMsg.includes('gateway timeout')
  ) {
    return {
      category: 'server_error',
      userMessage: 'The server is temporarily unavailable. Please try again shortly.',
      action: 'retry',
    }
  }

  // Default unknown fallback
  return {
    category: 'unknown',
    userMessage: 'Something went wrong while loading attendance. Please try again.',
    action: 'retry',
  }
}

/**
 * Redacts sensitive tokens, credentials, and secrets from strings.
 */
export function sanitizeDiagnosticString(str: string): string {
  return str
    // Redact JWT patterns (three base64url segments separated by dots)
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]')
    // Redact Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    // Redact password and secret assignments
    .replace(/(password|secret|token|api[_-]?key)=([^&\s]+)/gi, '$1=[REDACTED]')
}

/**
 * Recursively sanitizes an error or object for diagnostic logging.
 * Retains standard Error properties (name, message, code, status)
 * while stripping credentials, access tokens, refresh tokens, and JWTs.
 */
export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return '[NESTED_OBJECT]'
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    return sanitizeDiagnosticString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: sanitizeDiagnosticString(value.message),
    }
    const anyErr = value as any
    if (anyErr.code !== undefined) out.code = anyErr.code
    if (anyErr.status !== undefined) out.status = anyErr.status

    // Extract any additional enumerable properties
    for (const key of Object.keys(value)) {
      if (/password|token|secret|jwt|bearer|key|auth|credential/i.test(key)) {
        out[key] = '[REDACTED]'
      } else if (!['name', 'message'].includes(key)) {
        out[key] = sanitizeDiagnosticValue((value as any)[key], depth + 1)
      }
    }
    return out
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(item => sanitizeDiagnosticValue(item, depth + 1))
    }
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (/password|token|secret|jwt|bearer|key|auth|credential/i.test(key)) {
        out[key] = '[REDACTED]'
      } else {
        out[key] = sanitizeDiagnosticValue(val, depth + 1)
      }
    }
    return out
  }

  return String(value)
}

/**
 * Sanitizes and logs diagnostic errors without exposing credentials, tokens, or JWTs.
 * Safe to call at error handling points. Does not log when no error exists.
 */
export function logDiagnostic(error: unknown): void {
  if (error === null || error === undefined) return
  try {
    const sanitized = sanitizeDiagnosticValue(error)
    console.error('[Attendance Diagnostic]:', sanitized)
  } catch {
    // Avoid throwing in diagnostic logger
  }
}

