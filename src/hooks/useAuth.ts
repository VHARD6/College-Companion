import { useEffect, useState, useCallback } from 'react'
import { supabase, getSupabaseConfigStatus } from '../lib/supabase'
import {
  normalizeEmail,
  validateEmail,
  validatePassword,
  formatAuthError,
  formatDatabaseAuthError,
  logAuthDiagnostic,
  validatePortalAccess,
  type PortalType,
} from '../lib/authUtils'
import type { Profile } from '../types'
import type { User } from '@supabase/supabase-js'

export interface SignUpOptions {
  name: string
  rollNo?: string
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)

  // Verify Supabase configuration on initialization
  useEffect(() => {
    const config = getSupabaseConfigStatus()
    if (!config.isValid) {
      setConfigError(config.error || 'Invalid Supabase configuration')
    }
  }, [])

  // Load profile for a given user id
  const loadProfile = useCallback(async (userId?: string) => {
    try {
      const { data: userData } = await supabase.auth.getUser()
      const currentUser = userData?.user ?? null
      setUser(currentUser)

      const targetId = userId ?? currentUser?.id
      if (!targetId) {
        setProfile(null)
        setProfileError(null)
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle()

      if (error) {
        logAuthDiagnostic('loadProfile:query_error', error)
        setProfile(null)
        setProfileError(formatDatabaseAuthError(error))
      } else if (data) {
        setProfile(data)
        setProfileError(null)
      } else {
        // Authenticated user exists but profile row has not yet been reconciled
        logAuthDiagnostic('loadProfile:missing_profile_row', {
          userId: targetId,
          message: 'User authenticated in auth.users but has no corresponding row in public.profiles.',
        })
        setProfile(null)
        setProfileError('Profile record not found.')
      }
    } catch (err: any) {
      logAuthDiagnostic('loadProfile:unexpected_exception', err)
      setProfile(null)
      setProfileError(formatDatabaseAuthError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfile()

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        loadProfile(session.user.id)
      } else {
        setUser(null)
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Sign In with email and password
  const signIn = async (email: string, password: string) => {
    const config = getSupabaseConfigStatus()
    if (!config.isValid) {
      throw new Error(config.error)
    }

    const cleanEmail = normalizeEmail(email)
    const emailCheck = validateEmail(cleanEmail)
    if (!emailCheck.isValid) {
      throw new Error(emailCheck.error)
    }

    const passCheck = validatePassword(password)
    if (!passCheck.isValid) {
      throw new Error(passCheck.error)
    }

    try {
      const response = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password, // preserve exact password characters
      })

      if (response.error) {
        throw new Error(formatAuthError(response.error))
      }

      return response
    } catch (err: any) {
      throw new Error(formatAuthError(err))
    }
  }

  // Sign In with role validation for target portal
  const signInForPortal = async (email: string, password: string, portal: PortalType) => {
    const response = await signIn(email, password)
    const authedUser = response?.data?.user
    if (!authedUser) {
      throw new Error('Authentication succeeded but user details were not received.')
    }

    // Query user profile directly from public.profiles
    const { data: userProfile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authedUser.id)
      .maybeSingle()

    if (profErr) {
      logAuthDiagnostic('signInForPortal:profile_query_error', profErr)
      await signOut()
      throw new Error(formatDatabaseAuthError(profErr))
    }

    if (!userProfile) {
      logAuthDiagnostic('signInForPortal:missing_profile_row', {
        userId: authedUser.id,
        email: authedUser.email,
        message: 'Authentication succeeded, but public.profiles contains no record for this user UUID.',
      })
      await signOut()
      throw new Error('Account profile not found. Please contact your college administrator or register as a student.')
    }

    const check = validatePortalAccess(portal, userProfile)
    if (!check.allowed) {
      // Role mismatch or inactive account -> sign out immediately to preserve security
      await signOut()
      const mismatchErr: any = new Error(check.error)
      mismatchErr.suggestedPortal = check.suggestedPortal
      throw mismatchErr
    }

    setProfile(userProfile)
    setProfileError(null)
    return {
      user: authedUser,
      profile: userProfile,
      redirectPath: check.redirectPath!,
    }
  }

  // Student Sign Up
  const signUp = async (email: string, password: string, options: SignUpOptions) => {
    const config = getSupabaseConfigStatus()
    if (!config.isValid) {
      throw new Error(config.error)
    }

    const cleanEmail = normalizeEmail(email)
    const emailCheck = validateEmail(cleanEmail)
    if (!emailCheck.isValid) {
      throw new Error(emailCheck.error)
    }

    const passCheck = validatePassword(password)
    if (!passCheck.isValid) {
      throw new Error(passCheck.error)
    }

    const cleanName = (options.name || '').trim()
    if (!cleanName) {
      throw new Error('Full name is required.')
    }

    try {
      const response = await supabase.auth.signUp({
        email: cleanEmail,
        password, // preserve exact password characters
        options: {
          data: {
            name: cleanName,
            role: 'student', // Client requests student; database trigger strictly enforces this
            roll_no: options.rollNo?.trim() || null,
          },
        },
      })

      if (response.error) {
        throw new Error(formatAuthError(response.error))
      }

      return response
    } catch (err: any) {
      throw new Error(formatAuthError(err))
    }
  }

  // Password Reset Email
  const resetPassword = async (email: string) => {
    const config = getSupabaseConfigStatus()
    if (!config.isValid) {
      throw new Error(config.error)
    }

    const cleanEmail = normalizeEmail(email)
    const emailCheck = validateEmail(cleanEmail)
    if (!emailCheck.isValid) {
      throw new Error(emailCheck.error)
    }

    try {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined
      const response = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      })
      if (response.error) {
        throw new Error(formatAuthError(response.error))
      }
      return response
    } catch (err: any) {
      throw new Error(formatAuthError(err))
    }
  }

  // Resend Email Verification
  const resendVerification = async (email: string) => {
    const config = getSupabaseConfigStatus()
    if (!config.isValid) {
      throw new Error(config.error)
    }

    const cleanEmail = normalizeEmail(email)
    const emailCheck = validateEmail(cleanEmail)
    if (!emailCheck.isValid) {
      throw new Error(emailCheck.error)
    }

    try {
      const response = await supabase.auth.resend({
        type: 'signup',
        email: cleanEmail,
      })
      if (response.error) {
        throw new Error(formatAuthError(response.error))
      }
      return response
    } catch (err: any) {
      throw new Error(formatAuthError(err))
    }
  }

  // Sign Out
  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      setUser(null)
      setProfile(null)
      setProfileError(null)
    }
  }

  return {
    user,
    profile,
    profileError,
    loading,
    isProfilePending: !!user && !profile && !loading && profileError === 'Profile record not found.',
    configError,
    signIn,
    signInForPortal,
    signUp,
    resetPassword,
    resendVerification,
    signOut,
    refreshProfile: () => loadProfile(),
  }
}
