import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import TopBar from '../../components/ui/TopBar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import { todayISO, formatDate } from '../../lib/utils'
import {
  sortStudentsByRollNo,
  calculateAttendanceCounts,
  toggleAttendanceStatus,
  getAbsentStudents,
} from '../../lib/attendanceWorkflow'
import {
  resolveRosterInitializationState,
  evaluateAttendanceSaveAction,
  AttendanceGuardError,
  hasUnsavedAttendanceChanges,
} from '../../lib/attendanceSessionInit'
import { registerHardwareBackHandler } from '../../lib/backButtonHandler'
import { classifyAttendanceError, logDiagnostic } from '../../lib/errors'
import { Capacitor } from '@capacitor/core'
import toast from 'react-hot-toast'
import {
  Search,
  Lock,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  BookOpen,
  ArrowLeftRight,
  ChevronRight,
  Users,
  CheckCircle2,
  Calendar,
} from 'lucide-react'
import type { AttendanceStatus, SessionType } from '../../types'

export default function MarkAttendancePage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const rawAssignmentId = searchParams.get('assignmentId')
  const rawSessionId = searchParams.get('sessionId')

  const [assignmentId, setAssignmentId] = useState<number | null>(rawAssignmentId ? Number(rawAssignmentId) : null)
  const [createdSessionId, setCreatedSessionId] = useState<number | null>(null)
  const [sessionDate, setSessionDate] = useState<string>(todayISO())
  const [userSessionType, setUserSessionType] = useState<SessionType | null>(null)
  const [isSelectingAssignment, setIsSelectingAssignment] = useState<boolean>(!rawAssignmentId && !rawSessionId)

  // 3-Step Wizard Navigation: 1 = Mark Attendance, 2 = Review Absentees, 3 = Final Review
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1)

  // Search filter
  const [search, setSearch] = useState('')

  // Shared single source of truth for student attendance statuses: studentId -> 'present' | 'absent'
  const [rosterStatus, setRosterStatus] = useState<Record<number, AttendanceStatus>>({})
  const [initializedKey, setInitializedKey] = useState<string | null>(null)

  const rosterStatusRef = useRef<Record<number, AttendanceStatus>>(rosterStatus)
  const rosterSessionIdRef = useRef<number | null | undefined>(undefined)

  // Saved baseline to detect unsaved changes reliably
  const baselineRosterRef = useRef<Record<number, AttendanceStatus> | null>(null)
  const isDiscardingRef = useRef(false)

  useEffect(() => {
    rosterStatusRef.current = rosterStatus
  }, [rosterStatus])

  // Dialog states
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const pendingNavigationRef = useRef<(() => void) | null>(null)

  // Edit reason (required when modifying an already submitted session)
  const [editReason, setEditReason] = useState('')

  // Authentication error state during save / submit actions
  const [saveAuthError, setSaveAuthError] = useState<string | null>(null)

  // Helper: check if attendance differs from saved baseline
  const hasUnsavedChanges = useCallback(() => {
    if (isDiscardingRef.current) return false
    return hasUnsavedAttendanceChanges(rosterStatus, baselineRosterRef.current)
  }, [rosterStatus])

  // Fresh state ref to prevent stale closures in hardware back handler
  const stateRef = useRef({
    showConfirmModal,
    showUnsavedModal,
    currentStep,
    isSelectingAssignment,
    hasUnsavedChanges: false,
  })
  useEffect(() => {
    stateRef.current = {
      showConfirmModal,
      showUnsavedModal,
      currentStep,
      isSelectingAssignment,
      hasUnsavedChanges: hasUnsavedChanges(),
    }
  })

  // Hardware back button integration (Android / Capacitor)
  useEffect(() => {
    const unregister = registerHardwareBackHandler(() => {
      const state = stateRef.current
      // 1. If unsaved changes modal is open, first back action dismisses it (stays on page)
      if (state.showUnsavedModal) {
        setShowUnsavedModal(false)
        pendingNavigationRef.current = null
        return true
      }
      // 2. If submission confirmation modal is open, first back action closes it
      if (state.showConfirmModal) {
        setShowConfirmModal(false)
        return true
      }
      // 3. Step 3 -> Step 2
      if (state.currentStep === 3) {
        setCurrentStep(2)
        return true
      }
      // 4. Step 2 -> Step 1
      if (state.currentStep === 2) {
        setCurrentStep(1)
        return true
      }
      // 5. If in assignment selection view but already had an active assignment, return to it
      if (state.isSelectingAssignment && assignmentId) {
        setIsSelectingAssignment(false)
        return true
      }
      // 6. On Step 1 with unsaved changes, prompt before leaving
      if (state.hasUnsavedChanges) {
        pendingNavigationRef.current = null
        setShowUnsavedModal(true)
        return true
      }
      // 7. No unsaved changes: allow default navigation (navigate(-1) or app exit)
      return false
    })

    return unregister
  }, [assignmentId])

  // Browser navigation / tab closing guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Browser SPA history back navigation guard (web browser desktop and mobile)
  const hasGuardHistoryRef = useRef(false)

  // Push guard history entry when in an interceptable state
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    if (typeof window === 'undefined' || !window.history) return

    const shouldIntercept =
      hasUnsavedChanges() ||
      showConfirmModal ||
      showUnsavedModal ||
      currentStep > 1 ||
      (isSelectingAssignment && assignmentId !== null)

    if (shouldIntercept && !hasGuardHistoryRef.current) {
      window.history.pushState({ unsavedGuard: true }, '', window.location.href)
      hasGuardHistoryRef.current = true
    }
  }, [
    hasUnsavedChanges,
    showConfirmModal,
    showUnsavedModal,
    currentStep,
    isSelectingAssignment,
    assignmentId,
  ])

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    if (typeof window === 'undefined') return

    const handlePopState = () => {
      const wasGuarded = hasGuardHistoryRef.current
      hasGuardHistoryRef.current = false
      const state = stateRef.current

      // If user is explicitly discarding, allow navigation
      if (isDiscardingRef.current) {
        return
      }

      // If this back navigation occurred from an un-guarded clean state, allow default browser transition
      if (!wasGuarded) {
        return
      }

      // 1. If unsaved changes modal is open, first back dismisses it (stays on page)
      if (state.showUnsavedModal) {
        setShowUnsavedModal(false)
        pendingNavigationRef.current = null
        window.history.pushState({ unsavedGuard: true }, '', window.location.href)
        hasGuardHistoryRef.current = true
        return
      }

      // 2. If submission confirmation modal is open, first back closes it
      if (state.showConfirmModal) {
        setShowConfirmModal(false)
        window.history.pushState({ unsavedGuard: true }, '', window.location.href)
        hasGuardHistoryRef.current = true
        return
      }

      // 3. Step 3 -> Step 2
      if (state.currentStep === 3) {
        setCurrentStep(2)
        window.history.pushState({ unsavedGuard: true }, '', window.location.href)
        hasGuardHistoryRef.current = true
        return
      }

      // 4. Step 2 -> Step 1
      if (state.currentStep === 2) {
        setCurrentStep(1)
        window.history.pushState({ unsavedGuard: true }, '', window.location.href)
        hasGuardHistoryRef.current = true
        return
      }

      // 5. If in assignment selection view but already had an active assignment, return to it
      if (state.isSelectingAssignment && assignmentId) {
        setIsSelectingAssignment(false)
        window.history.pushState({ unsavedGuard: true }, '', window.location.href)
        hasGuardHistoryRef.current = true
        return
      }

      // 6. On Step 1 with unsaved changes, prompt before leaving
      if (state.hasUnsavedChanges) {
        pendingNavigationRef.current = () => {
          isDiscardingRef.current = true
          if (window.history.length > 1 && window.history.state?.idx !== 0) {
            navigate(-1)
          } else {
            navigate('/professor')
          }
        }
        setShowUnsavedModal(true)
        return
      }

      // 7. Was guarded, but state reverted to clean: complete back navigation to previous page
      isDiscardingRef.current = true
      if (window.history.length > 1 && window.history.state?.idx !== 0) {
        navigate(-1)
      } else {
        navigate('/professor')
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [assignmentId, navigate])

  // 1. Fetch professor record
  const {
    data: professor,
    isLoading: isProfLoading,
    isError: isProfError,
    error: profError,
    refetch: refetchProf,
  } = useQuery({
    queryKey: ['my-professor', profile?.id],
    enabled: !!profile && (profile.role === 'professor' || profile.role === 'admin'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('professors')
        .select('id, department_id')
        .eq('user_id', profile!.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  // 2. Fetch all authorized teaching assignments for this professor
  const {
    data: professorAssignments,
    isLoading: isAssignmentsLoading,
    isError: isAssignmentsError,
    error: assignmentsError,
    refetch: refetchAssignments,
  } = useQuery({
    queryKey: ['professor-all-assignments', professor?.id],
    enabled: !!professor?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select(`
          id,
          class_id,
          batch_id,
          subjects(id, name, type, code),
          classes(id, name, semester),
          batches(id, name)
        `)
        .eq('professor_id', professor!.id)
        .order('id')
      if (error) throw error
      return data ?? []
    },
  })

  // 3. Fetch attendance policy for correction window
  const { data: policy } = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance_policy').select('*').single()
      if (error) throw error
      return data
    },
  })

  // 3b. Auto-detect existing session for (assignmentId, sessionDate) when not opened with a specific sessionId
  const {
    data: dateSessionData,
    isLoading: isCheckingDateSession,
    isError: isDateSessionError,
    error: dateSessionError,
    refetch: refetchDateSession,
  } = useQuery({
    queryKey: ['date-session', assignmentId, sessionDate],
    enabled: !!assignmentId && !rawSessionId && !isSelectingAssignment,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, date, session_type, status')
        .eq('teaching_assignment_id', assignmentId!)
        .eq('date', sessionDate)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const effectiveSessionId = rawSessionId
    ? Number(rawSessionId)
    : (createdSessionId ?? dateSessionData?.id ?? null)
  const isDetectingSession = !rawSessionId && !createdSessionId && isCheckingDateSession

  // 4. Fetch existing session if sessionId was provided or discovered
  const {
    data: existingSession,
    isLoading: sessionLoading,
    isError: isSessionError,
    error: sessionError,
    refetch: refetchSession,
  } = useQuery({
    queryKey: ['session', effectiveSessionId],
    enabled: !!effectiveSessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, teaching_assignments(id, class_id, batch_id, subjects(id, name, type, code), classes(id, name), batches(id, name))')
        .eq('id', effectiveSessionId!)
        .single()
      if (error) throw error
      if (data) {
        setSessionDate(data.date)
        setAssignmentId(data.teaching_assignment_id)
        setIsSelectingAssignment(false)
      }
      return data
    },
  })

  // Derived session_type from user selection, existing session, detected date session, or default
  const sessionType: SessionType =
    userSessionType ??
    (existingSession?.session_type as SessionType) ??
    (dateSessionData?.session_type as SessionType) ??
    'lecture'

  // 5. Fetch teaching assignment details if no existing session yet
  const {
    data: assignmentData,
    isError: isAssignmentError,
    error: assignmentError,
    refetch: refetchAssignment,
  } = useQuery({
    queryKey: ['assignment', assignmentId],
    enabled: !!assignmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select('id, class_id, batch_id, subjects(id, name, type, code), classes(id, name), batches(id, name)')
        .eq('id', assignmentId!)
        .single()
      if (error) throw error
      return data
    },
  })

  const currentAssignment = existingSession?.teaching_assignments || assignmentData
  const classId = (currentAssignment as any)?.class_id
  const batchId = (currentAssignment as any)?.batch_id

  // 6. Fetch enrolled students for this class & batch
  const {
    data: rawStudents,
    isLoading: studentsLoading,
    isError: isStudentsError,
    error: studentsError,
    refetch: refetchStudents,
  } = useQuery({
    queryKey: ['class-students', classId, batchId],
    enabled: !!classId && !isSelectingAssignment,
    queryFn: async () => {
      let query = supabase
        .from('students')
        .select('id, roll_no, batch_id, profiles(name)')
        .eq('class_id', classId)

      // Practical sessions are restricted strictly to that specific batch
      if (batchId !== null && batchId !== undefined) {
        query = query.eq('batch_id', batchId)
      }

      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
  })

  // Sort students by roll number naturally (handles alphanumeric roll numbers safely)
  const students = useMemo(() => {
    if (!rawStudents) return []
    return sortStudentsByRollNo(rawStudents)
  }, [rawStudents])

  // 7. Fetch existing attendance records if session exists
  const {
    data: existingRecords,
    isLoading: recordsLoading,
    isError: isRecordsError,
    error: recordsError,
    refetch: refetchRecords,
  } = useQuery({
    queryKey: ['attendance-records', effectiveSessionId],
    enabled: !!effectiveSessionId && !isSelectingAssignment,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', effectiveSessionId!)
      if (error) throw error
      return data ?? []
    },
  })

  // 8. Initialize roster status safely:
  // - For an existing session: wait for query; on failure, HALT and report error (never default to present)
  // - For a new session: all students start as 'present'
  // - For an existing session: restore saved statuses
  useEffect(() => {
    if (isDetectingSession || isDateSessionError) return
    if (!students || students.length === 0) return

    const resolution = resolveRosterInitializationState({
      sessionId: effectiveSessionId,
      students,
      existingRecords,
      isRecordsLoading: !!effectiveSessionId && recordsLoading,
      isRecordsError: !!effectiveSessionId && isRecordsError,
      recordsError,
      isSessionLookupError: !rawSessionId && !createdSessionId && isDateSessionError,
      sessionLookupError: dateSessionError,
      currentRoster: Object.keys(rosterStatusRef.current).length > 0 ? rosterStatusRef.current : null,
      currentRosterSessionId: rosterSessionIdRef.current,
      sessionStatus: existingSession?.status,
    })

    if (resolution.state === 'READY') {
      if (resolution.source !== 'in_memory_preserved') {
        const recordsKey = existingRecords ? existingRecords.length : 'unloaded'
        const loadKey = `${assignmentId}-${effectiveSessionId ?? 'new'}-${recordsKey}-${resolution.source}`

        if (initializedKey !== loadKey) {
          setRosterStatus(resolution.roster)
          rosterStatusRef.current = resolution.roster
          rosterSessionIdRef.current = effectiveSessionId
          baselineRosterRef.current = { ...resolution.roster }
          setInitializedKey(loadKey)
        }
      } else {
        rosterSessionIdRef.current = effectiveSessionId
      }
    }
  }, [
    isDetectingSession,
    isDateSessionError,
    dateSessionError,
    rawSessionId,
    createdSessionId,
    students,
    existingRecords,
    assignmentId,
    effectiveSessionId,
    initializedKey,
    recordsLoading,
    isRecordsError,
    recordsError,
    existingSession?.status,
  ])

  // Derived absentees for Step 2
  const absentees = useMemo(() => {
    return getAbsentStudents(students, rosterStatus)
  }, [students, rosterStatus])

  // Filter students by search (for Step 1 and Step 3)
  const filteredStudents = useMemo(() => {
    if (!students) return []
    const q = search.trim().toLowerCase()
    if (!q) return students
    return students.filter(s =>
      s.roll_no.toLowerCase().includes(q) ||
      (s.profiles as any)?.name?.toLowerCase().includes(q)
    )
  }, [students, search])

  // Status checks and correction window calculation
  const isSubmitted = existingSession?.status === 'submitted'
  const correctionWindowHours = policy?.correction_window_hrs ?? 24
  const [mountTime] = useState(() => Date.now())

  const isWithinCorrectionWindow = !existingSession?.submitted_at
    ? true
    : mountTime - new Date(existingSession.submitted_at).getTime() <= correctionWindowHours * 3600 * 1000

  const isLocked = isSubmitted && !isWithinCorrectionWindow

  // Live counters derived from single source of truth
  const { total: totalCount, present: presentCount, absent: absentCount } = useMemo(() => {
    return calculateAttendanceCounts(students?.length ?? 0, rosterStatus)
  }, [students?.length, rosterStatus])

  // Bulk actions
  const markAll = (status: AttendanceStatus) => {
    if (isLocked || !students) return
    const updated: Record<number, AttendanceStatus> = {}
    students.forEach(s => { updated[s.id] = status })
    setRosterStatus(updated)
  }

  // Switch assignment handler
  const handleSelectAssignment = (newAssignmentId: number) => {
    setAssignmentId(newAssignmentId)
    setCreatedSessionId(null)
    setRosterStatus({})
    rosterStatusRef.current = {}
    rosterSessionIdRef.current = undefined
    baselineRosterRef.current = null
    setUserSessionType(null)
    setInitializedKey(null)
    setCurrentStep(1)
    setSearch('')
    setEditReason('')
    setSaveAuthError(null)
    setIsSelectingAssignment(false)
    setSearchParams({ assignmentId: String(newAssignmentId) })
  }

  // Handle auth expired navigation with explicit confirmation
  const handleAuthExpiredSignIn = () => {
    const confirmationText = effectiveSessionId
      ? 'Your unsaved changes will be lost if you leave. Any previously saved drafts will remain intact. Leave to sign in now?'
      : 'Your unsaved attendance marks will be lost if you leave. Leave to sign in now?'

    const confirmed = window.confirm(confirmationText)
    if (confirmed) {
      isDiscardingRef.current = true
      navigate('/login')
    }
  }

  // Handle wizard step back navigation
  const handleBack = () => {
    setSaveAuthError(null)
    if (showUnsavedModal) {
      setShowUnsavedModal(false)
      pendingNavigationRef.current = null
      return
    }
    if (showConfirmModal) {
      setShowConfirmModal(false)
      return
    }
    if (currentStep === 3) {
      setCurrentStep(2)
      return
    }
    if (currentStep === 2) {
      setCurrentStep(1)
      return
    }
    // On Step 1: guard unsaved changes before leaving
    const executeLeave = () => {
      isDiscardingRef.current = true
      if (!rawAssignmentId) {
        setIsSelectingAssignment(true)
      } else if (window.history.length > 1 && window.history.state?.idx !== 0) {
        navigate(-1)
      } else {
        navigate('/professor')
      }
    }

    if (hasUnsavedChanges()) {
      pendingNavigationRef.current = executeLeave
      setShowUnsavedModal(true)
      return
    }
    executeLeave()
  }

  // Atomic Save / Submit Mutation via Database RPC functions
  const saveMutation = useMutation({
    mutationFn: async ({ submitFinal }: { submitFinal: boolean }) => {
      if (!profile || !assignmentId) throw new Error('Missing profile or assignment information')

      if (!rawSessionId && !createdSessionId && isDateSessionError) {
        throw new AttendanceGuardError(
          'Cannot save or submit attendance because session lookup encountered an error.',
          'UNRESOLVED_RECORDS'
        )
      }

      const operation = !submitFinal ? 'save_draft' : (!isSubmitted ? 'submit' : 'correct')

      const guard = evaluateAttendanceSaveAction({
        operation,
        sessionId: effectiveSessionId,
        isSubmitted,
        isLocked,
        studentsCount: students?.length ?? 0,
        hasInMemoryRoster: Object.keys(rosterStatus).length > 0,
        isRosterMatchingSession:
          rosterSessionIdRef.current !== undefined &&
          (effectiveSessionId !== null && effectiveSessionId !== undefined
            ? rosterSessionIdRef.current === effectiveSessionId
            : rosterSessionIdRef.current === null),
        existingRecords,
        isRecordsLoading: !!effectiveSessionId && recordsLoading,
        isRecordsError: !!effectiveSessionId && isRecordsError,
        isSessionLookupError: !rawSessionId && !createdSessionId && isDateSessionError,
        editReason,
      })

      if (!guard.allowed) {
        throw new AttendanceGuardError(guard.reason ?? 'Attendance action cannot be processed.', guard.code)
      }

      // Case A: Save Draft (Atomic RPC)
      if (!submitFinal) {
        const recordsPayload = (students ?? []).map(student => ({
          student_id: student.id,
          status: rosterStatus[student.id] ?? 'present',
        }))

        const { data: rpcData, error: rpcErr } = await supabase.rpc('save_draft_session', {
          p_session_id: effectiveSessionId,
          p_teaching_assignment_id: assignmentId,
          p_date: sessionDate,
          p_session_type: sessionType,
          p_records: recordsPayload,
        })

        if (rpcErr) throw rpcErr
        return { submitFinal: false, sessionId: rpcData?.session_id }
      }

      // Case B: Initial Final Submission (Atomic RPC)
      if (!isSubmitted) {
        const recordsPayload = (students ?? []).map(student => ({
          student_id: student.id,
          status: rosterStatus[student.id] ?? 'present',
        }))

        const { data: rpcData, error: rpcErr } = await supabase.rpc('submit_attendance_session', {
          p_session_id: effectiveSessionId,
          p_teaching_assignment_id: assignmentId,
          p_date: sessionDate,
          p_session_type: sessionType,
          p_records: recordsPayload,
        })

        if (rpcErr) throw rpcErr
        return { submitFinal: true, sessionId: rpcData?.session_id }
      }

      // Case C: Modifying an Already Submitted Session (Atomic Correction RPC)
      if (!editReason.trim()) {
        throw new Error('A mandatory reason is required for attendance corrections.')
      }

      const existingMap = new Map(existingRecords?.map(r => [r.student_id, r]) ?? [])
      const changes: Array<{ student_id: number; new_status: AttendanceStatus }> = []

      students?.forEach(student => {
        const currentVal = rosterStatus[student.id] ?? 'present'
        const previousVal = existingMap.get(student.id)?.status
        if (previousVal && previousVal !== currentVal) {
          changes.push({
            student_id: student.id,
            new_status: currentVal,
          })
        }
      })

      if (changes.length === 0) {
        throw new Error('No status changes detected to record.')
      }

      const { data: rpcData, error: rpcErr } = await supabase.rpc('correct_attendance_records', {
        p_session_id: effectiveSessionId!,
        p_changes: changes,
        p_reason: editReason.trim(),
      })

      if (rpcErr) throw rpcErr
      return { submitFinal: true, sessionId: effectiveSessionId, changesApplied: rpcData?.changes_applied }
    },
    onSuccess: (data) => {
      setSaveAuthError(null)
      queryClient.invalidateQueries({ queryKey: ['session', effectiveSessionId] })
      queryClient.invalidateQueries({ queryKey: ['attendance-records', effectiveSessionId] })
      queryClient.invalidateQueries({ queryKey: ['date-session', assignmentId, sessionDate] })
      queryClient.invalidateQueries({ queryKey: ['professor-today'] })
      queryClient.invalidateQueries({ queryKey: ['professor-today-slots'] })
      queryClient.invalidateQueries({ queryKey: ['professor-drafts'] })
      queryClient.invalidateQueries({ queryKey: ['student-attendance'] })
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] })
      queryClient.invalidateQueries({ queryKey: ['admin-submitted-sessions'] })

      if (data.submitFinal) {
        isDiscardingRef.current = true
        toast.success(isSubmitted ? 'Attendance modifications saved!' : 'Attendance successfully submitted!')
        navigate('/professor')
      } else {
        toast.success('Draft saved.')
        baselineRosterRef.current = { ...rosterStatus }
        if (data.sessionId) {
          rosterSessionIdRef.current = data.sessionId
        }
        if (data.sessionId && data.sessionId !== effectiveSessionId) {
          setCreatedSessionId(data.sessionId)
          setSearchParams({ sessionId: String(data.sessionId) })
          queryClient.invalidateQueries({ queryKey: ['session', data.sessionId] })
          queryClient.invalidateQueries({ queryKey: ['attendance-records', data.sessionId] })
          queryClient.invalidateQueries({ queryKey: ['date-session', assignmentId, sessionDate] })
        }
      }
    },
    onError: (err: unknown) => {
      // 1. Pure domain guard rejection: show domain message, never route through remote error sanitizer
      if (
        err instanceof AttendanceGuardError ||
        (typeof err === 'object' && err !== null && (err as any).name === 'AttendanceGuardError')
      ) {
        toast.error((err as any).message || 'Action not permitted.')
        return
      }

      // 2. Actual remote / backend / network / server failure: log once at error-handling point
      logDiagnostic(err)
      const classified = classifyAttendanceError(err, 'save')

      if (classified.action === 'sign_in') {
        setSaveAuthError(classified.userMessage)
        toast(
          (t) => (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{classified.userMessage}</span>
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(t.id)
                  handleAuthExpiredSignIn()
                }}
                className="px-2.5 py-1 bg-blue-600 text-white text-xs font-bold rounded-lg shrink-0 hover:bg-blue-700 transition-colors"
              >
                Sign In
              </button>
            </div>
          ),
          { id: 'save-auth-expired', duration: 8000 }
        )
      } else {
        toast.error(classified.userMessage)
      }
    },
  })

  const subject = (currentAssignment as any)?.subjects
  const cls = (currentAssignment as any)?.classes
  const batch = (currentAssignment as any)?.batches
  const isRecordsFatalError = !!effectiveSessionId && isRecordsError && existingRecords === undefined
  const isRecordsLoading = !!effectiveSessionId && recordsLoading && existingRecords === undefined
  const isLoading = sessionLoading || studentsLoading || isRecordsLoading || isDetectingSession
  const hasError = isSessionError || isAssignmentError || isStudentsError || isDateSessionError || isRecordsFatalError
  const rawError = (isRecordsFatalError ? recordsError : null) || (isDateSessionError ? dateSessionError : null) || sessionError || assignmentError || studentsError
  const classifiedError = classifyAttendanceError(rawError)

  // Log diagnostic error information once when a query failure occurs (never on ordinary renders, never when no error)
  useEffect(() => {
    if (rawError) {
      logDiagnostic(rawError)
    }
  }, [rawError])

  // ───────────────────────────────────────────────────────────────────────────
  // VIEW 0: Assignment Selection Screen
  // ───────────────────────────────────────────────────────────────────────────
  if (!assignmentId || isSelectingAssignment) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col pb-16">
        <TopBar
          title="Select Subject & Class"
          showBack={!!assignmentId}
          onBack={() => setIsSelectingAssignment(false)}
        />

        <div className="p-4 max-w-lg mx-auto w-full space-y-4">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl p-4 text-white shadow-xs">
            <h2 className="text-lg font-bold">Mark Attendance</h2>
            <p className="text-xs opacity-90 mt-1">
              Select an authorized teaching assignment to start the 3-step attendance process.
            </p>
          </div>

          {isAssignmentsLoading || isProfLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-8 w-8" />
            </div>
          ) : isAssignmentsError || isProfError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2">
              <AlertCircle size={24} className="text-red-500 mx-auto" />
              <p className="font-semibold text-red-900 text-sm">Failed to load teaching assignments</p>
              <p className="text-xs text-red-600">
                {(assignmentsError as any)?.message || (profError as any)?.message || 'Database connection error'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  refetchProf()
                  refetchAssignments()
                }}
              >
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </div>
          ) : !professor ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
              <Users size={32} className="text-amber-500 mx-auto" />
              <h3 className="font-semibold text-amber-900 text-sm">Faculty Account Setup Required</h3>
              <p className="text-xs text-amber-700 leading-relaxed">
                Your user account is assigned the Professor role, but your faculty profile has not yet been linked to an academic department in the faculty directory. Please contact your college administrator to complete your profile setup.
              </p>
              {profile?.role === 'admin' && (
                <div className="pt-2">
                  <Link
                    to="/admin/users"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors"
                  >
                    Assign Department in Admin Portal
                  </Link>
                </div>
              )}
            </div>
          ) : !professorAssignments || professorAssignments.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
              <BookOpen size={32} className="text-amber-500 mx-auto" />
              <h3 className="font-semibold text-amber-900 text-sm">No Teaching Assignments Found</h3>
              <p className="text-xs text-amber-700 leading-relaxed">
                You have not been assigned to any subjects or classes yet. Please contact your college administrator to configure your teaching assignments.
              </p>
              {profile?.role === 'admin' && (
                <div className="pt-2">
                  <Link
                    to="/admin/assignments"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                  >
                    Configure Teaching Assignments
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Your Teaching Assignments ({professorAssignments.length})
              </h3>
              {professorAssignments.map(a => {
                const sub = (a as any).subjects
                const cl = (a as any).classes
                const bt = (a as any).batches
                const isSelected = a.id === assignmentId

                return (
                  <Card
                    key={a.id}
                    onClick={() => handleSelectAssignment(a.id)}
                    className={`hover:shadow-md transition-all cursor-pointer ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-100 bg-blue-50/20' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-sm text-gray-900 truncate">
                            {sub?.name ?? 'Subject'}
                          </p>
                          <span className="text-xs text-gray-400 font-mono">
                            {sub?.code}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                          <span className="bg-gray-100 px-2 py-0.5 rounded-md font-medium">
                            {cl?.name} (Sem {cl?.semester})
                          </span>
                          <span className={`px-2 py-0.5 rounded-md font-medium ${
                            bt ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {bt ? `Batch: ${bt.name}` : 'Theory (All Batches)'}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-gray-400 shrink-0" />
                    </div>
                  </Card>
                )
              })}

              {assignmentId && (
                <Button
                  variant="outline"
                  className="w-full mt-3"
                  onClick={() => setIsSelectingAssignment(false)}
                >
                  Return to Active Session
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3-STEP WIZARD VIEWS
  // ───────────────────────────────────────────────────────────────────────────
  const stepTitles = {
    1: '1. Mark Attendance',
    2: '2. Review Absentees',
    3: '3. Final Review & Submit',
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-36">
      <TopBar
        title={stepTitles[currentStep]}
        showBack
        onBack={handleBack}
      />

      {/* ─── 3-Step Progress Indicator ─── */}
      <div className="sticky top-[53px] z-20 bg-white border-b border-gray-200">
        <div className="max-w-lg mx-auto flex items-center justify-between px-4 py-2.5">
          {/* Step 1 Pill */}
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              currentStep === 1
                ? 'text-blue-600 font-bold'
                : 'text-gray-500 hover:text-gray-800 font-medium'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                currentStep === 1
                  ? 'bg-blue-600 text-white'
                  : currentStep > 1
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {currentStep > 1 ? '✓' : '1'}
            </span>
            <span className="hidden sm:inline">Mark Attendance</span>
            <span className="sm:hidden">Mark</span>
          </button>

          <span className="text-gray-300 text-xs font-bold">→</span>

          {/* Step 2 Pill */}
          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            disabled={hasError || isLoading || !students || students.length === 0}
            className={`flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 ${
              currentStep === 2
                ? 'text-blue-600 font-bold'
                : 'text-gray-500 hover:text-gray-800 font-medium'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                currentStep === 2
                  ? 'bg-blue-600 text-white'
                  : currentStep > 2
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {currentStep > 2 ? '✓' : '2'}
            </span>
            <span className="hidden sm:inline">Absentees ({hasError || isLoading ? '--' : absentCount})</span>
            <span className="sm:hidden">Absentees ({hasError || isLoading ? '--' : absentCount})</span>
          </button>

          <span className="text-gray-300 text-xs font-bold">→</span>

          {/* Step 3 Pill */}
          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            disabled={hasError || isLoading || !students || students.length === 0}
            className={`flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 ${
              currentStep === 3
                ? 'text-blue-600 font-bold'
                : 'text-gray-500 hover:text-gray-800 font-medium'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                currentStep === 3
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              3
            </span>
            <span className="hidden sm:inline">Final Review</span>
            <span className="sm:hidden">Review</span>
          </button>
        </div>

        {/* Live Counters Banner */}
        <div className="bg-gray-50/90 border-t border-gray-100 px-4 py-2">
          <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
            <div className="flex-1 bg-white border border-gray-200 rounded-xl py-1 px-2 text-center shadow-2xs">
              <span className="text-[11px] text-gray-500 font-medium">Total: </span>
              <span className="text-xs font-bold text-gray-800">{hasError || isLoading ? '--' : totalCount}</span>
            </div>
            <div className="flex-1 bg-green-50 border border-green-200 rounded-xl py-1 px-2 text-center shadow-2xs">
              <span className="text-[11px] text-green-700 font-medium">Present: </span>
              <span className="text-xs font-bold text-green-800">{hasError || isLoading ? '--' : presentCount}</span>
            </div>
            <div className="flex-1 bg-red-50 border border-red-200 rounded-xl py-1 px-2 text-center shadow-2xs">
              <span className="text-[11px] text-red-700 font-medium">Absent: </span>
              <span className="text-xs font-bold text-red-800">{hasError || isLoading ? '--' : absentCount}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto w-full flex-1">
        {/* Error State Banner */}
        {hasError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2">
            <AlertCircle size={24} className="text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-red-900">Failed to load session details</p>
            <p className="text-xs text-red-600">{classifiedError.userMessage}</p>
            {classifiedError.action === 'sign_in' ? (
              <div className="flex gap-2 justify-center pt-1">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleAuthExpiredSignIn}
                >
                  Sign In
                </Button>
              </div>
            ) : classifiedError.action === 'retry' ? (
              <div className="flex gap-2 justify-center pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    refetchSession()
                    refetchAssignment()
                    refetchStudents()
                    if (!rawSessionId) {
                      refetchDateSession()
                    }
                    if (effectiveSessionId) {
                      refetchRecords()
                    }
                  }}
                >
                  <RefreshCw size={14} className="mr-1.5" />
                  Retry
                </Button>
              </div>
            ) : classifiedError.action === 'none' ? (
              <div className="flex gap-2 justify-center pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBack}
                >
                  ← Go Back
                </Button>
              </div>
            ) : null}
          </div>
        )}

        {/* Background Records Refetch Error Notice (Non-blocking) */}
        {!hasError && !!effectiveSessionId && isRecordsError && existingRecords !== undefined && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center justify-between gap-3 text-xs text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0" />
              <span>Failed to refresh saved attendance records. Your current screen marks are preserved.</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 bg-white"
              onClick={() => refetchRecords()}
            >
              <RefreshCw size={12} className="mr-1" />
              Retry
            </Button>
          </div>
        )}

        {/* Locked / Correction Window Notice (if previously submitted) */}
        {isSubmitted && !hasError && (
          <div className={`rounded-2xl p-3.5 border ${isLocked ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
            <div className="flex items-start gap-2">
              {isLocked ? <Lock size={18} className="text-red-600 shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />}
              <div className="text-xs">
                <p className="font-semibold">
                  {isLocked ? 'Session Locked' : 'Correction Window Active'}
                </p>
                <p className="mt-0.5">
                  {isLocked
                    ? `The ${correctionWindowHours}h correction window has passed. Changes can no longer be made.`
                    : `Submitted attendance can be adjusted within ${correctionWindowHours} hours of submission. An edit reason is required for audit logs.`}
                </p>
              </div>
            </div>

            {!isLocked && (
              <div className="mt-2.5">
                <Input
                  label="Reason for modification (Mandatory)"
                  placeholder="e.g. Roll 12 was marked absent by mistake"
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────────
            PAGE 1 — MARK ATTENDANCE
            ───────────────────────────────────────────────────────────────────── */}
        {currentStep === 1 && !hasError && (
          <div className="space-y-3.5 animate-in fade-in duration-200">
            {/* Session Context & Setup */}
            <div className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-2xs space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-gray-900 text-sm leading-tight">
                    {subject?.name ?? 'Subject'}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {cls?.name}{batch ? ` (${batch.name})` : ' · Whole Class'} · {subject?.code}
                  </p>
                </div>
                {!isSubmitted && (
                  <button
                    type="button"
                    onClick={() => {
                      if (hasUnsavedChanges()) {
                        pendingNavigationRef.current = () => setIsSelectingAssignment(true)
                        setShowUnsavedModal(true)
                      } else {
                        setIsSelectingAssignment(true)
                      }
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full font-medium shrink-0 transition-colors"
                  >
                    <ArrowLeftRight size={11} />
                    <span>Switch</span>
                  </button>
                )}
              </div>

              {!isSubmitted && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                  <Input
                    label="Date"
                    type="date"
                    max={todayISO()}
                    value={sessionDate}
                    onChange={e => {
                      const newDate = e.target.value
                      if (newDate === sessionDate) return
                      const applyDateChange = () => {
                        setSessionDate(newDate)
                        setCreatedSessionId(null)
                        setRosterStatus({})
                        rosterStatusRef.current = {}
                        rosterSessionIdRef.current = undefined
                        baselineRosterRef.current = null
                        setUserSessionType(null)
                        setInitializedKey(null)
                      }
                      if (hasUnsavedChanges()) {
                        pendingNavigationRef.current = applyDateChange
                        setShowUnsavedModal(true)
                      } else {
                        applyDateChange()
                      }
                    }}
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Session Type</label>
                    <select
                      className="block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={sessionType}
                      onChange={e => setUserSessionType(e.target.value as SessionType)}
                    >
                      <option value="lecture">Lecture</option>
                      <option value="practical">Practical</option>
                      <option value="tutorial">Tutorial</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Instruction Callout */}
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl px-3.5 py-2 text-xs text-blue-900 flex items-center gap-2">
              <span className="font-semibold text-blue-700 shrink-0">Default:</span>
              <span>All students start as <strong>Present [ P ]</strong>. Tap any student to mark them <strong>Absent [ A ]</strong>.</span>
            </div>

            {/* Search & Bulk Toggle Controls */}
            {!isLocked && (students?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    placeholder="Search student name or roll number..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 text-xs bg-green-100 hover:bg-green-200 text-green-800 py-1.5 rounded-xl font-medium transition-colors"
                    onClick={() => markAll('present')}
                  >
                    Mark All Present
                  </button>
                  <button
                    type="button"
                    className="flex-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 py-1.5 rounded-xl font-medium transition-colors"
                    onClick={() => markAll('absent')}
                  >
                    Mark All Absent
                  </button>
                </div>
              </div>
            )}

            {/* Student Roster List */}
            {isLoading ? (
              <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
            ) : !students || students.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
                <Users size={32} className="text-amber-500 mx-auto" />
                <h3 className="font-semibold text-amber-900 text-sm">No Enrolled Students Found</h3>
                <p className="text-xs text-amber-700 leading-relaxed">
                  No students are enrolled in {cls?.name ?? 'this class division'}
                  {batch ? ` (Batch: ${batch.name})` : ''}.
                </p>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                No matching students found for "{search}"
              </div>
            ) : (
              <div className="space-y-2">
                {filteredStudents.map(student => {
                  const studentName = (student.profiles as any)?.name ?? 'Unnamed Student'
                  const isPresent = (rosterStatus[student.id] ?? 'present') === 'present'

                  return (
                    <div
                      key={student.id}
                      className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-3.5 py-2.5 shadow-2xs hover:border-gray-300 transition-colors"
                    >
                      <div className="min-w-0 pr-3 flex items-center gap-3">
                        <span className="font-mono text-xs font-bold text-gray-500 w-12 shrink-0">
                          {student.roll_no}
                        </span>
                        <span className="font-medium text-sm text-gray-900 truncate">
                          {studentName}
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return
                          setRosterStatus(prev => ({
                            ...prev,
                            [student.id]: toggleAttendanceStatus(prev[student.id] ?? 'present'),
                          }))
                        }}
                        aria-label={`${student.roll_no} ${studentName}: currently ${isPresent ? 'Present' : 'Absent'}. Tap to toggle.`}
                        className={`w-12 h-11 rounded-xl font-bold text-base transition-all flex items-center justify-center shadow-xs active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                          isPresent
                            ? 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500'
                            : 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
                        } ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <span className="select-none">{isPresent ? 'P' : 'A'}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────────
            PAGE 2 — REVIEW ABSENTEES
            ───────────────────────────────────────────────────────────────────── */}
        {currentStep === 2 && !hasError && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-2xs space-y-1">
              <h3 className="font-bold text-gray-900 text-sm">
                Review Absentees ({absentCount})
              </h3>
              <p className="text-xs text-gray-500">
                Verify students marked absent. Tap <strong>[ A ]</strong> if a student was marked absent by mistake to return them to Present.
              </p>
            </div>

            {absentCount === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center space-y-3 shadow-2xs">
                <CheckCircle2 size={40} className="text-green-600 mx-auto" />
                <div>
                  <h3 className="font-bold text-green-950 text-base">Everyone is present!</h3>
                  <p className="text-xs text-green-700 mt-1 max-w-xs mx-auto">
                    All {totalCount} students in this roster are marked as Present. You can proceed to final review and submit.
                  </p>
                </div>
                <div className="flex gap-2 justify-center pt-2">
                  <Button variant="outline" size="sm" onClick={() => setCurrentStep(1)}>
                    ← Back to Attendance
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setCurrentStep(3)}>
                    Review Final Attendance →
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-red-800 uppercase tracking-wide px-1">
                  Absent Students ({absentCount})
                </div>

                {absentees.map(student => {
                  const studentName = (student.profiles as any)?.name ?? 'Unnamed Student'
                  return (
                    <div
                      key={student.id}
                      className="flex items-center justify-between bg-white rounded-xl border border-red-200 px-3.5 py-2.5 shadow-2xs hover:border-red-300 transition-colors"
                    >
                      <div className="min-w-0 pr-3 flex items-center gap-3">
                        <span className="font-mono text-xs font-bold text-red-600 w-12 shrink-0">
                          {student.roll_no}
                        </span>
                        <span className="font-medium text-sm text-gray-900 truncate">
                          {studentName}
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return
                          // When student changes from Absent to Present, remove immediately from list
                          setRosterStatus(prev => ({
                            ...prev,
                            [student.id]: 'present',
                          }))
                        }}
                        aria-label={`${student.roll_no} ${studentName}: marked absent. Tap to change to Present.`}
                        title="Tap to mark Present"
                        className="w-12 h-11 bg-red-600 hover:bg-red-700 text-white font-bold text-base rounded-xl transition-all shadow-xs active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 flex items-center justify-center cursor-pointer"
                      >
                        <span className="select-none">A</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────────
            PAGE 3 — FINAL REVIEW AND SUBMISSION
            ───────────────────────────────────────────────────────────────────── */}
        {currentStep === 3 && !hasError && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Detailed Summary Card */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs space-y-2.5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-gray-900 text-base leading-tight">
                    {subject?.name ?? 'Subject'}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    {subject?.code} · {subject?.type}
                  </p>
                </div>
                <Badge variant={isSubmitted ? (isLocked ? 'red' : 'green') : 'yellow'}>
                  {isSubmitted ? (isLocked ? 'Locked' : 'Submitted') : 'Draft'}
                </Badge>
              </div>

              <div className="text-xs text-gray-600 flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <span className="bg-gray-100 px-2 py-0.5 rounded-md font-medium">
                  {cls?.name} (Sem {cls?.semester})
                </span>
                {batch && (
                  <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-md font-medium">
                    Batch: {batch.name}
                  </span>
                )}
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md font-medium capitalize">
                  {sessionType}
                </span>
                <span className="bg-gray-100 px-2 py-0.5 rounded-md font-medium flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(sessionDate)}
                </span>
              </div>

              <div className="pt-2 flex items-center justify-between text-xs font-semibold bg-gray-50 rounded-xl p-2.5">
                <span className="text-gray-700">Total: {totalCount}</span>
                <span className="text-green-700 font-bold">Present: {presentCount}</span>
                <span className="text-red-700 font-bold">Absent: {absentCount}</span>
              </div>
            </div>

            {/* Editable Final Roster */}
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Complete Roster ({totalCount})
                </h4>
                <span className="text-[11px] text-gray-400">
                  Tap P/A to correct any mistake
                </span>
              </div>

              <div className="space-y-2">
                {students?.map(student => {
                  const studentName = (student.profiles as any)?.name ?? 'Unnamed Student'
                  const isPresent = (rosterStatus[student.id] ?? 'present') === 'present'

                  return (
                    <div
                      key={student.id}
                      className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-3.5 py-2.5 shadow-2xs hover:border-gray-300 transition-colors"
                    >
                      <div className="min-w-0 pr-3 flex items-center gap-3">
                        <span className="font-mono text-xs font-bold text-gray-500 w-12 shrink-0">
                          {student.roll_no}
                        </span>
                        <span className="font-medium text-sm text-gray-900 truncate">
                          {studentName}
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return
                          // Instant update in shared state
                          setRosterStatus(prev => ({
                            ...prev,
                            [student.id]: toggleAttendanceStatus(prev[student.id] ?? 'present'),
                          }))
                        }}
                        aria-label={`${student.roll_no} ${studentName}: currently ${isPresent ? 'Present' : 'Absent'}. Tap to toggle.`}
                        className={`w-12 h-11 rounded-xl font-bold text-base transition-all flex items-center justify-center shadow-xs active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                          isPresent
                            ? 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500'
                            : 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
                        } ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <span className="select-none">{isPresent ? 'P' : 'A'}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          FIXED BOTTOM ACTION BAR PER STEP
          ───────────────────────────────────────────────────────────────────── */}
      {!isLocked && !hasError && !isLoading && (students?.length ?? 0) > 0 && (
        <div className="fixed bottom-[56px] left-0 right-0 bg-white border-t border-gray-200 p-3 z-30 shadow-lg">
          <div className="max-w-lg mx-auto space-y-2">
            {saveAuthError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 text-xs text-red-900 flex items-center justify-between gap-2">
                <span className="font-medium">{saveAuthError}</span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleAuthExpiredSignIn}
                >
                  Sign In
                </Button>
              </div>
            )}
            <div className="flex gap-2.5">
              {/* Step 1 Actions */}
              {currentStep === 1 && (
                <>
                  {!isSubmitted && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      loading={saveMutation.isPending}
                      onClick={() => saveMutation.mutate({ submitFinal: false })}
                    >
                      Save Draft
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={() => setCurrentStep(2)}
                  >
                    Review Absentees ({absentCount}) →
                  </Button>
                </>
              )}

              {/* Step 2 Actions */}
              {currentStep === 2 && (
                <>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setCurrentStep(1)}
                  >
                    ← Back to Attendance
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={() => setCurrentStep(3)}
                  >
                    Review Final Attendance →
                  </Button>
                </>
              )}

              {/* Step 3 Actions */}
              {currentStep === 3 && (
                <>
                  <Button
                    variant="outline"
                    className="shrink-0 px-3.5"
                    onClick={() => setCurrentStep(2)}
                  >
                    ← Back
                  </Button>
                  {!isSubmitted && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      loading={saveMutation.isPending}
                      onClick={() => saveMutation.mutate({ submitFinal: false })}
                    >
                      Save Draft
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    className="flex-1"
                    loading={saveMutation.isPending}
                    disabled={isSubmitted && !editReason.trim()}
                    onClick={() => {
                      if (isSubmitted) {
                        saveMutation.mutate({ submitFinal: true })
                      } else {
                        setShowConfirmModal(true)
                      }
                    }}
                  >
                    {isSubmitted ? 'Save Changes' : 'Submit Attendance'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          LIGHTWEIGHT CONFIRMATION MODAL FOR STEP 3
          ───────────────────────────────────────────────────────────────────── */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-gray-900">
              Confirm Attendance Submission
            </h3>

            <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-xs text-blue-950 space-y-1.5">
              <p className="font-semibold text-sm text-blue-900">
                {subject?.name}
              </p>
              <p className="text-gray-600">
                {cls?.name}{batch ? ` (Batch: ${batch.name})` : ''} · {formatDate(sessionDate)} ({sessionType})
              </p>
              <div className="pt-2 border-t border-blue-200/50 flex justify-between font-bold text-xs">
                <span className="text-gray-700">Total: {totalCount}</span>
                <span className="text-green-700">Present: {presentCount}</span>
                <span className="text-red-700">Absent: {absentCount}</span>
              </div>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed">
              Once submitted, attendance is locked. Future modifications will require a mandatory audit reason.
            </p>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                disabled={saveMutation.isPending}
                onClick={() => setShowConfirmModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                loading={saveMutation.isPending}
                onClick={() => {
                  setShowConfirmModal(false)
                  saveMutation.mutate({ submitFinal: true })
                }}
              >
                Confirm &amp; Submit
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          UNSAVED CHANGES CONFIRMATION MODAL
          ───────────────────────────────────────────────────────────────────── */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Unsaved Changes
                </h3>
                <p className="text-xs text-gray-500">
                  Attendance marks have not been saved
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              If you leave now, your unsaved changes will be discarded. Are you sure you want to discard your changes and leave?
            </p>

            <div className="flex gap-2 pt-1">
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  isDiscardingRef.current = true
                  setShowUnsavedModal(false)
                  if (pendingNavigationRef.current) {
                    const nav = pendingNavigationRef.current
                    pendingNavigationRef.current = null
                    nav()
                  } else {
                    if (window.history.length > 1 && window.history.state?.idx !== 0) {
                      navigate(-1)
                    } else {
                      navigate('/professor')
                    }
                  }
                }}
              >
                Discard Changes
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowUnsavedModal(false)
                  pendingNavigationRef.current = null
                }}
              >
                Keep Editing
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
