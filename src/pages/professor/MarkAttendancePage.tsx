import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import TopBar from '../../components/ui/TopBar'
import Toggle from '../../components/ui/Toggle'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import { todayISO, formatDate } from '../../lib/utils'
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
  const [sessionId, setSessionId] = useState<number | null>(rawSessionId ? Number(rawSessionId) : null)
  const [sessionDate, setSessionDate] = useState<string>(todayISO())
  const [sessionType, setSessionType] = useState<SessionType>('lecture')
  const [isSelectingAssignment, setIsSelectingAssignment] = useState<boolean>(!rawAssignmentId && !rawSessionId)

  // Search filter
  const [search, setSearch] = useState('')

  // Map of studentId → user override
  const [attendanceOverrides, setAttendanceOverrides] = useState<Record<number, AttendanceStatus>>({})

  // Edit reason (required when session is submitted)
  const [editReason, setEditReason] = useState('')

  // Fetch the professor row for the logged-in user
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

  // Fetch all authorized teaching assignments for this professor
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

  // Fetch attendance policy for correction window
  const { data: policy } = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance_policy').select('*').single()
      if (error) throw error
      return data
    },
  })

  // Fetch existing session if sessionId was provided or discovered
  const {
    data: existingSession,
    isLoading: sessionLoading,
    isError: isSessionError,
    error: sessionError,
    refetch: refetchSession,
  } = useQuery({
    queryKey: ['session', sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, teaching_assignments(id, class_id, batch_id, subjects(id, name, type, code), classes(id, name), batches(id, name))')
        .eq('id', sessionId!)
        .single()
      if (error) throw error
      if (data) {
        setSessionDate(data.date)
        setSessionType(data.session_type as SessionType)
        setAssignmentId(data.teaching_assignment_id)
        setIsSelectingAssignment(false)
      }
      return data
    },
  })

  // Fetch teaching assignment details if no existing session yet
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

  // Auto-detect if a session already exists for this (assignmentId, sessionDate) when not loaded by rawSessionId
  useEffect(() => {
    if (!assignmentId || rawSessionId) return

    let isMounted = true
    async function checkDateSession() {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, date, session_type, status')
        .eq('teaching_assignment_id', assignmentId!)
        .eq('date', sessionDate)
        .maybeSingle()

      if (!isMounted) return
      if (error) {
        console.error('Failed to check session for date:', error)
        return
      }

      if (data?.id) {
        setSessionId(data.id)
        setSessionType(data.session_type as SessionType)
      } else {
        setSessionId(null)
      }
    }

    checkDateSession()
    return () => { isMounted = false }
  }, [assignmentId, sessionDate, rawSessionId])

  // Fetch enrolled students for this class & batch (enforcing strict batch boundary)
  const {
    data: students,
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
        .order('roll_no')

      // Practical sessions are restricted strictly to that specific batch
      if (batchId) {
        query = query.eq('batch_id', batchId)
      }

      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
  })

  // Fetch existing attendance records if session exists
  const { data: existingRecords } = useQuery({
    queryKey: ['attendance-records', sessionId],
    enabled: !!sessionId && !isSelectingAssignment,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', sessionId!)
      if (error) throw error
      return data ?? []
    },
  })

  // Compute active attendance by merging base (from existingRecords, defaulting to 'present') + user overrides
  const attendance = useMemo<Record<number, AttendanceStatus>>(() => {
    if (!students || students.length === 0) return {}
    const base: Record<number, AttendanceStatus> = {}
    const existingMap = new Map(existingRecords?.map(r => [r.student_id, r.status as AttendanceStatus]) ?? [])

    students.forEach(s => {
      base[s.id] = existingMap.get(s.id) ?? 'present'
    })

    return { ...base, ...attendanceOverrides }
  }, [students, existingRecords, attendanceOverrides])

  // Filter students by search
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

  // Live counters
  const totalCount = students?.length ?? 0
  const presentCount = Object.values(attendance).filter(s => s === 'present').length
  const absentCount = Math.max(0, totalCount - presentCount)

  // Quick bulk toggle actions
  const markAll = (status: AttendanceStatus) => {
    if (isLocked || !students) return
    const overrides: Record<number, AttendanceStatus> = {}
    students.forEach(s => { overrides[s.id] = status })
    setAttendanceOverrides(overrides)
  }

  // Switch assignment handler
  const handleSelectAssignment = (newAssignmentId: number) => {
    setAssignmentId(newAssignmentId)
    setSessionId(null)
    setAttendanceOverrides({})
    setSearch('')
    setEditReason('')
    setIsSelectingAssignment(false)
    setSearchParams({ assignmentId: String(newAssignmentId) })
  }

  // Atomic Save / Submit Mutation via Database RPC functions
  const saveMutation = useMutation({
    mutationFn: async ({ submitFinal }: { submitFinal: boolean }) => {
      if (!profile || !assignmentId) throw new Error('Missing profile or assignment information')

      // Case A: Save Draft (Atomic RPC)
      if (!submitFinal) {
        const recordsPayload = (students ?? []).map(student => ({
          student_id: student.id,
          status: attendance[student.id] ?? 'present',
        }))

        const { data: rpcData, error: rpcErr } = await supabase.rpc('save_draft_session', {
          p_session_id: sessionId,
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
          status: attendance[student.id] ?? 'present',
        }))

        const { data: rpcData, error: rpcErr } = await supabase.rpc('submit_attendance_session', {
          p_session_id: sessionId,
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
        const currentVal = attendance[student.id] ?? 'present'
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
        p_session_id: sessionId!,
        p_changes: changes,
        p_reason: editReason.trim(),
      })

      if (rpcErr) throw rpcErr
      return { submitFinal: true, sessionId, changesApplied: rpcData?.changes_applied }
    },
    onSuccess: (data) => {
      setAttendanceOverrides({})
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['attendance-records', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['professor-today'] })
      queryClient.invalidateQueries({ queryKey: ['student-attendance'] })
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] })
      queryClient.invalidateQueries({ queryKey: ['admin-submitted-sessions'] })
      toast.success(data.submitFinal ? 'Attendance successfully submitted!' : 'Draft saved.')
      navigate('/professor')
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Failed to save attendance.')
    },
  })

  function handleSubmit() {
    if (absentCount < 0) return
    const msg = isSubmitted
      ? `Save modifications for this session?\nPresent: ${presentCount} / Absent: ${absentCount} / Total: ${totalCount}`
      : `Submit attendance?\nPresent: ${presentCount} | Absent: ${absentCount} | Total: ${totalCount}\n\nOnce submitted, modifications will require an edit reason.`

    if (window.confirm(msg)) {
      saveMutation.mutate({ submitFinal: true })
    }
  }

  const subject = (currentAssignment as any)?.subjects
  const cls = (currentAssignment as any)?.classes
  const batch = (currentAssignment as any)?.batches
  const isLoading = sessionLoading || studentsLoading
  const hasError = isSessionError || isAssignmentError || isStudentsError
  const errorMessage =
    (sessionError as any)?.message ||
    (assignmentError as any)?.message ||
    (studentsError as any)?.message

  // ───────────────────────────────────────────────────────────────────────────
  // VIEW A: Assignment Selection Screen
  // ───────────────────────────────────────────────────────────────────────────
  if (!assignmentId || isSelectingAssignment) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col pb-16">
        <TopBar
          title="Select Subject & Class"
          showBack={!!assignmentId}
        />

        <div className="p-4 max-w-lg mx-auto w-full space-y-4">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl p-4 text-white shadow-xs">
            <h2 className="text-lg font-bold">Mark Attendance</h2>
            <p className="text-xs opacity-90 mt-1">
              Select one of your authorized teaching assignments to take attendance or update drafts.
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
          ) : !professorAssignments || professorAssignments.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
              <BookOpen size={32} className="text-amber-500 mx-auto" />
              <h3 className="font-semibold text-amber-900 text-sm">No Teaching Assignments Found</h3>
              <p className="text-xs text-amber-700 leading-relaxed">
                You have not been assigned to any subjects or classes yet. Please contact your college administrator to configure your teaching assignments.
              </p>
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
                    className={`hover:shadow-md transition-all ${
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
  // VIEW B: Active Attendance Marking / Editing Screen
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-24">
      <TopBar
        title={isSubmitted ? 'Session Attendance' : 'Mark Attendance'}
        showBack
      />

      {/* Sticky Sub-Header with Counters & Assignment Switcher */}
      <div className="sticky top-[53px] z-10 bg-white border-b border-gray-200 px-4 py-3 shadow-2xs">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-gray-900 text-sm leading-tight truncate">
                {subject?.name ?? 'Subject'}
              </h2>
              {/* Assignment Switcher Button */}
              {!isSubmitted && (
                <button
                  type="button"
                  onClick={() => setIsSelectingAssignment(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5 bg-blue-50 px-2 py-0.5 rounded-full font-medium shrink-0"
                  title="Switch class or subject"
                >
                  <ArrowLeftRight size={11} />
                  <span>Switch</span>
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {cls?.name}{batch ? ` (${batch.name})` : ' · Whole Class'} · {formatDate(sessionDate)}
            </p>
          </div>
          <div className="shrink-0">
            {isSubmitted ? (
              <Badge variant={isLocked ? 'red' : 'green'}>
                {isLocked ? 'Locked' : 'Submitted'}
              </Badge>
            ) : (
              <Badge variant="yellow">Draft</Badge>
            )}
          </div>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-green-50 border border-green-200 rounded-xl py-1 px-2 text-center">
            <span className="text-xs text-green-700 font-medium">Present: </span>
            <span className="text-sm font-bold text-green-800">{presentCount}</span>
          </div>
          <div className="flex-1 bg-red-50 border border-red-200 rounded-xl py-1 px-2 text-center">
            <span className="text-xs text-red-700 font-medium">Absent: </span>
            <span className="text-sm font-bold text-red-800">{absentCount}</span>
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl py-1 px-2 text-center">
            <span className="text-xs text-gray-600 font-medium">Total: </span>
            <span className="text-sm font-bold text-gray-800">{totalCount}</span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto w-full flex-1">
        {/* Error State Banner */}
        {hasError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2">
            <AlertCircle size={24} className="text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-red-900">Failed to load session details</p>
            <p className="text-xs text-red-600">{errorMessage || 'Database connection error'}</p>
            <div className="flex gap-2 justify-center pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  refetchSession()
                  refetchAssignment()
                  refetchStudents()
                }}
              >
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Session Details / Date Picker */}
        {!isSubmitted && !hasError && (
          <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Date"
                type="date"
                max={todayISO()}
                value={sessionDate}
                onChange={e => setSessionDate(e.target.value)}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Session Type</label>
                <select
                  className="block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={sessionType}
                  onChange={e => setSessionType(e.target.value as SessionType)}
                >
                  <option value="lecture">Lecture</option>
                  <option value="practical">Practical</option>
                  <option value="tutorial">Tutorial</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Locked / Correction Window Notice */}
        {isSubmitted && !hasError && (
          <div className={`rounded-2xl p-4 border ${isLocked ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
            <div className="flex items-start gap-2">
              {isLocked ? <Lock size={20} className="text-red-600 shrink-0 mt-0.5" /> : <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />}
              <div className="text-sm">
                <p className="font-semibold">
                  {isLocked ? 'Session Locked' : 'Correction Window Active'}
                </p>
                <p className="text-xs mt-0.5">
                  {isLocked
                    ? `The ${correctionWindowHours}h correction window has passed. Changes can no longer be made.`
                    : `Submitted attendance can be adjusted within ${correctionWindowHours} hours of submission. An edit reason is required for audit logs.`}
                </p>
              </div>
            </div>

            {!isLocked && (
              <div className="mt-3">
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

        {/* Search & Bulk Toggle Controls */}
        {!isLocked && !hasError && (students?.length ?? 0) > 0 && (
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
                className="flex-1 text-xs bg-green-100 hover:bg-green-200 text-green-800 py-2 rounded-xl font-medium transition-colors"
                onClick={() => markAll('present')}
              >
                Mark All Present
              </button>
              <button
                type="button"
                className="flex-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 py-2 rounded-xl font-medium transition-colors"
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
        ) : hasError ? null : !students || students.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
            <Users size={32} className="text-amber-500 mx-auto" />
            <h3 className="font-semibold text-amber-900 text-sm">No Enrolled Students Found</h3>
            <p className="text-xs text-amber-700 leading-relaxed">
              No students are currently enrolled in {cls?.name ?? 'this class division'}
              {batch ? ` (Batch: ${batch.name})` : ''}.
              Please ask your college administrator to enroll students to this class in the Admin Portal.
            </p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No matching students found for "{search}"
          </div>
        ) : (
          <div className="space-y-2">
            {filteredStudents.map(student => {
              const studentName = (student.profiles as any)?.name ?? 'Unnamed'
              const isPresent = attendance[student.id] === 'present'
              return (
                <div
                  key={student.id}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-2xs hover:border-blue-200 transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <p className="font-medium text-sm text-gray-900 truncate">{studentName}</p>
                    <p className="text-xs text-gray-500 font-mono">{student.roll_no}</p>
                  </div>
                  <Toggle
                    checked={isPresent}
                    onChange={checked => {
                      if (isLocked) return
                      setAttendanceOverrides(prev => ({
                        ...prev,
                        [student.id]: checked ? 'present' : 'absent',
                      }))
                    }}
                    disabled={isLocked}
                    label={`Toggle ${studentName}`}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Fixed Bottom Action Bar */}
      {!isLocked && !hasError && (students?.length ?? 0) > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 z-20">
          <div className="max-w-lg mx-auto flex gap-3">
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
              onClick={handleSubmit}
            >
              {isSubmitted ? 'Save Changes' : 'Submit Attendance'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
