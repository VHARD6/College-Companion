import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { normalizeEmail, validateEmail, validatePassword } from '../../lib/authUtils'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import {
  GraduationCap,
  Briefcase,
  Sparkles,
  Eye,
  EyeOff,
  Mail,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  ShieldCheck,
  RefreshCw,
  LogOut,
  ArrowRight,
} from 'lucide-react'
import toast from 'react-hot-toast'

type PortalRole = 'student' | 'staff'
type AuthMode = 'signin' | 'register' | 'forgot' | 'verify'

export default function LoginPage() {
  const {
    signInForPortal,
    signUp,
    resetPassword,
    resendVerification,
    signOut,
    refreshProfile,
    profile,
    user,
    loading,
    isProfilePending,
    configError,
  } = useAuth()
  const navigate = useNavigate()

  // Navigation & state
  const [portal, setPortal] = useState<PortalRole>('student')
  const [mode, setMode] = useState<AuthMode>('signin')

  // Form inputs
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [rollNo, setRollNo] = useState('')

  // UI state
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestedPortal, setSuggestedPortal] = useState<PortalRole | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [checkingProfile, setCheckingProfile] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)

  // Redirect if already authenticated with active profile and not in submission flow
  useEffect(() => {
    if (!loading && profile && !submitting) {
      const dest = {
        student: '/student',
        professor: '/professor',
        admin: '/admin',
      }[profile.role]
      navigate(dest, { replace: true })
    }
  }, [loading, profile, submitting, navigate])

  const isStudent = portal === 'student'

  // Clear errors and mismatch flags when switching portal or mode
  const handlePortalChange = (newPortal: PortalRole) => {
    setPortal(newPortal)
    setMode('signin')
    setError(null)
    setSuggestedPortal(null)
  }

  const handleModeChange = (newMode: AuthMode) => {
    setMode(newMode)
    setError(null)
    setSuggestedPortal(null)
  }

  // Handle Sign In with strict Portal Role Enforcement
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuggestedPortal(null)

    const cleanEmail = normalizeEmail(email)
    const emailCheck = validateEmail(cleanEmail)
    if (!emailCheck.isValid) {
      setError(emailCheck.error || 'Please enter a valid email address.')
      return
    }

    const passCheck = validatePassword(password)
    if (!passCheck.isValid) {
      setError(passCheck.error || 'Please enter your password.')
      return
    }

    setSubmitting(true)
    try {
      const res = await signInForPortal(cleanEmail, password, portal)
      toast.success(
        isStudent ? 'Signed in! Opening student portal...' : 'Signed in! Opening staff portal...'
      )
      navigate(res.redirectPath, { replace: true })
    } catch (err: any) {
      const errMsg = err?.message || 'Authentication failed. Please verify your details.'
      setError(errMsg)
      if (err?.suggestedPortal) {
        setSuggestedPortal(err.suggestedPortal as PortalRole)
      } else {
        setSuggestedPortal(null)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Student Registration (Student Portal only)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuggestedPortal(null)

    const cleanName = name.trim()
    const cleanEmail = normalizeEmail(email)
    const cleanRollNo = rollNo.trim()

    if (!cleanName) {
      setError('Please enter your full name.')
      return
    }

    const emailCheck = validateEmail(cleanEmail)
    if (!emailCheck.isValid) {
      setError(emailCheck.error || 'Please enter a valid email address (e.g. name@gmail.com).')
      return
    }

    const passCheck = validatePassword(password)
    if (!passCheck.isValid) {
      setError(passCheck.error || 'Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-check.')
      return
    }

    setSubmitting(true)
    try {
      const res = await signUp(cleanEmail, password, {
        name: cleanName,
        rollNo: cleanRollNo || undefined,
      })

      if (res?.data?.session) {
        toast.success('Registration successful! Welcome to College Companion.')
      } else if (res?.data?.user) {
        setRegisteredEmail(cleanEmail)
        setMode('verify')
        toast.success('Account created! Please verify your email.')
      }
    } catch (err: any) {
      setError(err?.message || 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Forgot Password Request
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuggestedPortal(null)

    const cleanEmail = normalizeEmail(email)
    const emailCheck = validateEmail(cleanEmail)
    if (!emailCheck.isValid) {
      setError(emailCheck.error || 'Please enter a valid email address.')
      return
    }

    setSubmitting(true)
    try {
      await resetPassword(cleanEmail)
      setForgotSent(true)
      toast.success('Password reset instructions sent to your email.')
    } catch (err: any) {
      setError(err?.message || 'Unable to send reset email. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Resend Verification
  const handleResendVerification = async () => {
    if (!registeredEmail) return
    setResending(true)
    try {
      await resendVerification(registeredEmail)
      toast.success('Verification email sent again. Check your inbox & spam folder.')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to resend verification email.')
    } finally {
      setResending(false)
    }
  }

  // Handle Profile Recheck
  const handleCheckProfile = async () => {
    setCheckingProfile(true)
    try {
      await refreshProfile()
    } finally {
      setCheckingProfile(false)
    }
  }

  return (
    <div
      className={`min-h-screen flex flex-col justify-center items-center p-4 py-8 transition-colors duration-300 ${
        isStudent
          ? 'bg-gradient-to-br from-slate-50 via-sky-50 to-indigo-100 text-slate-800'
          : 'bg-gradient-to-br from-slate-950 via-slate-900 to-zinc-950 text-slate-100'
      }`}
    >
      <div
        className={`w-full max-w-md rounded-3xl p-6 sm:p-8 transition-all duration-300 ${
          isStudent
            ? 'bg-white shadow-xl border border-sky-100'
            : 'bg-slate-900/95 shadow-2xl border border-slate-700/80 backdrop-blur-md'
        }`}
      >
        {/* Supabase Missing Configuration Banner */}
        {configError && (
          <div className="mb-6 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-xs text-amber-800">
            <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">Configuration Notice</p>
              <p>{configError}</p>
            </div>
          </div>
        )}

        {/* Portal Switcher (Student vs Staff) */}
        <div
          className={`p-1 rounded-2xl flex items-center mb-6 transition-colors ${
            isStudent
              ? 'bg-slate-100 border border-slate-200/70'
              : 'bg-slate-800/90 border border-slate-700/60'
          }`}
        >
          <button
            type="button"
            onClick={() => handlePortalChange('student')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              isStudent
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GraduationCap size={16} />
            <span>Student Portal</span>
          </button>
          <button
            type="button"
            onClick={() => handlePortalChange('staff')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              !isStudent
                ? 'bg-slate-700/90 text-emerald-400 shadow-sm border border-slate-600/50'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Briefcase size={16} />
            <span>Staff / Faculty</span>
          </button>
        </div>

        {/* Brand / Logo Header */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div
            className={`p-3.5 rounded-2xl mb-3 transition-all ${
              isStudent
                ? 'bg-gradient-to-tr from-blue-600 to-sky-500 text-white shadow-md shadow-blue-500/25'
                : 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-600/30'
            }`}
          >
            {isStudent ? <GraduationCap size={32} /> : <Briefcase size={32} />}
          </div>
          <h1
            className={`text-2xl font-bold tracking-tight ${
              isStudent ? 'text-gray-900' : 'text-slate-100'
            }`}
          >
            College Companion
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase ${
                isStudent
                  ? 'bg-blue-50 text-blue-700 border border-blue-200/80'
                  : 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {isStudent ? 'Student Academic Portal' : 'Faculty & Staff Access'}
            </span>
          </div>
          <p
            className={`text-xs mt-1.5 ${
              isStudent ? 'text-gray-500' : 'text-slate-400'
            }`}
          >
            {isStudent
              ? 'Student Attendance & Academic Timetable'
              : 'Official Faculty & Administrative Management'}
          </p>
        </div>

        {/* ─── PENDING PROFILE RECONCILIATION SCREEN ─── */}
        {isProfilePending && user && (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={28} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Profile Initializing</h2>
              <p className="text-xs text-gray-600 mt-1">
                Signed in as <span className="font-semibold">{user.email}</span>
              </p>
            </div>
            <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-800 text-left space-y-1.5 leading-relaxed">
              <p>Your authentication succeeded, but your user profile has not been initialized in the database yet.</p>
              <p className="text-[11px] text-amber-700">
                <strong>For Administrators:</strong> Please ensure migration <code className="bg-amber-100 px-1 py-0.5 rounded">004_fix_handle_new_user_trigger.sql</code> has been run in the Supabase SQL Editor.
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <Button
                type="button"
                className="w-full"
                onClick={handleCheckProfile}
                loading={checkingProfile}
              >
                <RefreshCw size={16} className="mr-1.5" />
                Retry Profile Check
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full text-xs"
                onClick={signOut}
              >
                <LogOut size={16} className="mr-1.5" />
                Sign Out
              </Button>
            </div>
          </div>
        )}

        {/* If not pending profile, show normal portal flows */}
        {!isProfilePending && (
          <>
            {/* Staff Policy Notice: Highlight restricted access & no public self-registration */}
            {!isStudent && mode === 'signin' && (
              <div className="mb-5 p-3.5 bg-slate-800/80 border border-slate-700/80 rounded-2xl flex items-start gap-2.5 text-xs text-slate-300">
                <ShieldCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-100">Restricted Staff Access</p>
                  <p className="text-slate-400 mt-0.5 leading-relaxed">
                    Faculty and Administrator accounts are provisioned exclusively by college administration. Self-registration is restricted.
                  </p>
                </div>
              </div>
            )}

            {/* Student Mode Switcher (Sign In vs Register) — Strictly Student Only */}
            {isStudent && mode !== 'verify' && mode !== 'forgot' && (
              <div className="flex border-b border-gray-100 mb-5">
                <button
                  type="button"
                  onClick={() => handleModeChange('signin')}
                  className={`flex-1 py-2 text-sm font-semibold text-center border-b-2 transition-all ${
                    mode === 'signin'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('register')}
                  className={`flex-1 py-2 text-sm font-semibold text-center border-b-2 transition-all ${
                    mode === 'register'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            {/* Gmail Support Pill (Student mode) */}
            {isStudent && (
              <div className="mb-4 flex items-center justify-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full text-xs text-emerald-700 font-medium">
                <Sparkles size={13} className="text-emerald-500" />
                <span>Personal & college Gmail accounts supported</span>
              </div>
            )}

            {/* ─── ROLE MISMATCH / ERROR BANNER WITH QUICK SWITCH ACTION ─── */}
            {error && (
              <div
                className={`mb-4 p-3.5 rounded-2xl border text-xs space-y-2.5 transition-all ${
                  isStudent
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-red-950/40 border-red-800/60 text-red-300'
                }`}
              >
                <div className="flex items-start gap-2">
                  <AlertCircle
                    size={16}
                    className={`shrink-0 mt-0.5 ${
                      isStudent ? 'text-red-600' : 'text-red-400'
                    }`}
                  />
                  <div className="leading-relaxed">
                    <p className="font-semibold">{error}</p>
                  </div>
                </div>

                {/* Actionable Switch Button when Role Mismatch is detected */}
                {suggestedPortal && (
                  <button
                    type="button"
                    onClick={() => handlePortalChange(suggestedPortal)}
                    className={`w-full py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-sm ${
                      suggestedPortal === 'student'
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                    }`}
                  >
                    {suggestedPortal === 'student' ? (
                      <>
                        <GraduationCap size={15} />
                        <span>Switch to Student Portal</span>
                        <ArrowRight size={14} className="ml-auto" />
                      </>
                    ) : (
                      <>
                        <Briefcase size={15} />
                        <span>Switch to Staff / Faculty Portal</span>
                        <ArrowRight size={14} className="ml-auto" />
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* ─── VIEW 1: EMAIL VERIFICATION REQUIRED SCREEN ─── */}
            {mode === 'verify' && (
              <div className="text-center py-2 space-y-4">
                <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                  <Mail size={28} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Verify Your Email</h2>
                  <p className="text-xs text-gray-600 mt-1">
                    We sent a confirmation link to:
                  </p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">{registeredEmail}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl text-xs text-gray-500 text-left space-y-1">
                  <p>• Check your inbox and click the verification link.</p>
                  <p>• If you don't see it, please check your spam/junk folder.</p>
                  <p>• Once confirmed, return here to sign in.</p>
                </div>
                <div className="space-y-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleResendVerification}
                    loading={resending}
                  >
                    Resend Verification Email
                  </Button>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => handleModeChange('signin')}
                  >
                    Back to Sign In
                  </Button>
                </div>
              </div>
            )}

            {/* ─── VIEW 2: FORGOT PASSWORD ─── */}
            {mode === 'forgot' && (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => handleModeChange('signin')}
                    className={`p-1 rounded-lg ${
                      isStudent
                        ? 'text-gray-400 hover:text-gray-700'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <h2
                    className={`text-base font-bold ${
                      isStudent ? 'text-gray-900' : 'text-slate-100'
                    }`}
                  >
                    Reset Your Password
                  </h2>
                </div>
                <p
                  className={`text-xs ${
                    isStudent ? 'text-gray-500' : 'text-slate-400'
                  }`}
                >
                  Enter the email address associated with your account. We will send you instructions to reset your password.
                </p>

                <Input
                  label="Account Email"
                  labelClassName={isStudent ? 'text-gray-700' : 'text-slate-300'}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={isStudent ? 'student@gmail.com' : 'faculty@college.edu'}
                  required
                  autoComplete="email"
                  className={
                    !isStudent
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-emerald-500'
                      : ''
                  }
                />

                {forgotSent && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 flex items-start gap-2">
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                    <span>If an account exists for this email, reset instructions have been sent.</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className={`w-full ${
                    isStudent
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                  size="lg"
                  loading={submitting}
                >
                  Send Reset Link
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={`w-full text-xs ${
                    !isStudent ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : ''
                  }`}
                  onClick={() => handleModeChange('signin')}
                >
                  Cancel and Return to Sign In
                </Button>
              </form>
            )}

            {/* ─── VIEW 3: STUDENT REGISTRATION (STUDENT PORTAL ONLY) ─── */}
            {isStudent && mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-3.5">
                <Input
                  label="Full Name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Aakash Sharma"
                  required
                  autoComplete="name"
                />

                <Input
                  label="Email Address"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="student@gmail.com"
                  required
                  autoComplete="email"
                />

                <Input
                  label="Roll / Student ID (Optional)"
                  type="text"
                  value={rollNo}
                  onChange={e => setRollNo(e.target.value)}
                  placeholder="e.g. CS2026-042"
                />

                <Input
                  label="Password (min. 6 characters)"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  rightElement={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
                />

                <Input
                  label="Confirm Password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  rightElement={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
                />

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/20"
                  size="lg"
                  loading={submitting}
                >
                  Create Student Account
                </Button>

                <p className="text-center text-xs text-gray-500 pt-1">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => handleModeChange('signin')}
                    className="text-blue-600 font-semibold hover:underline"
                  >
                    Sign In
                  </button>
                </p>
              </form>
            )}

            {/* ─── VIEW 4: SIGN IN (STUDENT OR STAFF) ─── */}
            {mode === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <Input
                    label={isStudent ? 'Student Email' : 'Faculty / Staff Email'}
                    labelClassName={isStudent ? 'text-gray-700' : 'text-slate-300'}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={isStudent ? 'student@gmail.com' : 'faculty@college.edu'}
                    required
                    autoComplete="email"
                    className={
                      !isStudent
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-emerald-500'
                        : ''
                    }
                  />
                </div>

                <div>
                  <Input
                    label="Password"
                    labelClassName={isStudent ? 'text-gray-700' : 'text-slate-300'}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className={
                      !isStudent
                        ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-emerald-500'
                        : ''
                    }
                    rightElement={
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(!showPassword)}
                        className={`focus:outline-none ${
                          isStudent
                            ? 'text-gray-400 hover:text-gray-600'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    }
                  />
                  <div className="flex justify-end mt-1.5">
                    <button
                      type="button"
                      onClick={() => handleModeChange('forgot')}
                      className={`text-xs hover:underline ${
                        isStudent ? 'text-blue-600' : 'text-emerald-400'
                      }`}
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className={`w-full ${
                    isStudent
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-700/30'
                  }`}
                  size="lg"
                  loading={submitting}
                >
                  {isStudent ? 'Sign In to Student Portal' : 'Sign In to Staff Portal'}
                </Button>

                {isStudent && (
                  <p className="text-center text-xs text-gray-500 pt-1">
                    Don't have an account yet?{' '}
                    <button
                      type="button"
                      onClick={() => handleModeChange('register')}
                      className="text-blue-600 font-semibold hover:underline"
                    >
                      Create Student Account
                    </button>
                  </p>
                )}
              </form>
            )}

            {/* Footer Guidance */}
            <div
              className={`mt-6 pt-4 border-t text-center text-xs ${
                isStudent
                  ? 'border-gray-100 text-gray-400'
                  : 'border-slate-800 text-slate-500'
              }`}
            >
              <p>
                {isStudent
                  ? 'Professor or Administrator? Tap "Staff / Faculty" above.'
                  : 'Enrolled student? Tap "Student Portal" above to sign in or register.'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
