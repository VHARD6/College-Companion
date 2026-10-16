import { useState, useMemo } from 'react'
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
import { todayISO, formatDate } from '../../lib/utils'
import toast from 'react-hot-toast'
import { Search, Lock, AlertTriangle } from 'lucide-react'
import type { AttendanceStatus, SessionType } from '../../types'

export default function MarkAttendancePage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const rawAssignmentId = searchParams.get('assignmentId')
  const rawSessionId = searchParams.get('sessionId')

  const [assignmentId, setAssignmentId] = useState<number | null>(rawAssignmentId ? Number(rawAssignmentId) : null)
  const [sessionId, setSessionId] = useState<number | null>(rawSessionId ? Number(rawSessionId) : null)
  const [sessionDate, setSessionDate] = useState<string>(todayISO())
  const [sessionType, setSessionType] = useState<SessionType>('lecture')

  // Search filter
  const [search, setSearch] = useState('')

  // Map of studentId → AttendanceStatus
  const [attendance, setAttendance] = useState<Record<number, AttendanceStatus>>({})

  // Edit reason (required when session is submitted)
  const [editReason, setEditReason] = useState('')

  // Fetch attendance policy for correction window
  const { data: policy } = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const { data } = await supabase.from('attendance_policy').select('*').single()
      return data
    },
  })

  // Fetch existing session if sessionId was provided or found
  const { data: existingSession, isLoading: sessionLoading } = useQuery({
    queryKey: ['session', sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, teaching_assignments(id, class_id, batch_id, subjects(name, type, code), classes(name), batches(name))')
        .eq('id', sessionId!)
        .single()
      if (error) throw error
      if (data) {
        setSessionDate(data.date)
        setSessionType(data.session_type as SessionType)
        setAssignmentId(data.teaching_assignment_id)
      }
      return data
    },
  })

  // Fetch teaching assignment if no existing session yet
  const { data: assignmentData } = useQuery({
    queryKey: ['assignment', assignmentId],
    enabled: !!assignmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select('id, class_id, batch_id, subjects(name, type, code), classes(name), batches(name)')
        .eq('id', assignmentId!)
        .single()
      if (error) throw error
      return data
    },
  })

  const currentAssignment = existingSession?.teaching_assignments || assignmentData
  const classId = (currentAssignment as any)?.class_id
  const batchId = (currentAssignment as any)?.batch_id

  // Check if session exists for this assignment + date if we don't have a sessionId yet
  useQuery({
    queryKey: ['check-session-date', assignmentId, sessionDate],
    enabled: !!assignmentId && !sessionId,
    queryFn: async () => {
      const { data } = await supabase
        .from('sessions')
        .select('id')
        .eq('teaching_assignment_id', assignmentId!)
        .eq('date', sessionDate)
        .maybeSingle()
      if (data?.id) {
        setSessionId(data.id)
      }
      return data
    },
  })

  // Fetch enrolled students for this class & batch
  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ['class-students', classId, batchId],
    enabled: !!classId,
    queryFn: async () => {
      let query = supabase
        .from('students')
        .select('id, roll_no, batch_id, profiles(name)')
        .eq('class_id', classId)
        .order('roll_no')

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
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', sessionId!)
      if (error) throw error

      if (data && data.length > 0) {
        const loaded: Record<number, AttendanceStatus> = {}
        data.forEach(r => {
          loaded[r.student_id] = r.status as AttendanceStatus
        })
        setAttendance(loaded)
      }
      return data ?? []
    },
  })

  // Initialize all students to 'present' if new session and not initialized
  const [hasInitialized, setHasInitialized] = useState(false)
  if (students && students.length > 0 && !hasInitialized) {
    if (!sessionId || !existingRecords || existingRecords.length === 0) {
      const initial: Record<number, AttendanceStatus> = {}
      students.forEach(s => { initial[s.id] = 'present' })
      setAttendance(initial)
    }
    setHasInitialized(true)
  }

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

  // Status checks
  const isSubmitted = existingSession?.status === 'submitted'
  const submittedAt = existingSession?.submitted_at ? new Date(existingSession.submitted_at) : null
  const correctionWindowHours = policy?.correction_window_hrs ?? 24
  const isWithinCorrectionWindow = submittedAt
    ? (Date.now() - submittedAt.getTime()) <= correctionWindowHours * 3600 * 1000
    : true

  const isLocked = isSubmitted && !isWithinCorrectionWindow

  // Live counters
  const totalCount = students?.length ?? 0
  const presentCount = Object.values(attendance).filter(s => s === 'present').length
  const absentCount = totalCount - presentCount

  // Quick actions
  const markAll = (status: AttendanceStatus) => {
    if (isLocked) return
    const updated: Record<number, AttendanceStatus> = {}
    students?.forEach(s => { updated[s.id] = status })
    setAttendance(updated)
  }

  // Save / Submit Mutation
  const saveMutation = useMutation({
    mutationFn: async ({ submitFinal }: { submitFinal: boolean }) => {
      if (!profile || !assignmentId) throw new Error('Missing profile or assignment information')

      if (submitFinal && isSubmitted && !editReason.trim()) {
        throw new Error('A reason is mandatory for modifying submitted attendance.')
      }

      let activeSessionId = sessionId

      // 1. Create session if it doesn't exist
      if (!activeSessionId) {
        const { data: newSession, error: sErr } = await supabase
          .from('sessions')
          .insert({
            teaching_assignment_id: assignmentId,
            date: sessionDate,
            session_type: sessionType,
            status: submitFinal ? 'submitted' : 'draft',
            submitted_at: submitFinal ? new Date().toISOString() : null,
            submitted_by: submitFinal ? profile.id : null,
          })
          .select('id')
          .single()

        if (sErr) throw sErr
        activeSessionId = newSession.id
        setSessionId(newSession.id)
      } else {
        // Update existing session
        const updatePayload: any = {
          date: sessionDate,
          session_type: sessionType,
        }
        if (submitFinal && !isSubmitted) {
          updatePayload.status = 'submitted'
          updatePayload.submitted_at = new Date().toISOString()
          updatePayload.submitted_by = profile.id
        }

        const { error: sUpdateErr } = await supabase
          .from('sessions')
          .update(updatePayload)
          .eq('id', activeSessionId)

        if (sUpdateErr) throw sUpdateErr
      }

      // 2. Prepare attendance records
      const recordsToUpsert = (students ?? []).map(student => ({
        session_id: activeSessionId!,
        student_id: student.id,
        status: attendance[student.id] ?? 'present',
        marked_by: profile.id,
        marked_at: new Date().toISOString(),
      }))

      // Check existing records for audit log diff
      const existingMap = new Map(existingRecords?.map(r => [r.student_id, r]) ?? [])

      const { data: savedRecords, error: rErr } = await supabase
        .from('attendance_records')
        .upsert(recordsToUpsert, { onConflict: 'session_id,student_id' })
        .select()

      if (rErr) throw rErr

      // 3. Write audit log entries
      if (savedRecords && savedRecords.length > 0) {
        if (!isSubmitted && submitFinal) {
          // First submission audit entries
          const initialLogs = savedRecords.map(r => ({
            record_id: r.id,
            old_status: null,
            new_status: r.status,
            changed_by: profile.id,
            reason: 'Initial submission',
          }))
          await supabase.from('attendance_audit_log').insert(initialLogs)
        } else if (isSubmitted) {
          // Edit changes audit entries
          const editLogs: any[] = []
          savedRecords.forEach(r => {
            const previous = existingMap.get(r.student_id)
            if (previous && previous.status !== r.status) {
              editLogs.push({
                record_id: r.id,
                old_status: previous.status,
                new_status: r.status,
                changed_by: profile.id,
                reason: editReason.trim(),
              })
            }
          })
          if (editLogs.length > 0) {
            await supabase.from('attendance_audit_log').insert(editLogs)
          }
        }
      }

      return { submitFinal }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['attendance-records', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['professor-today'] })
      queryClient.invalidateQueries({ queryKey: ['student-attendance'] })
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-24">
      <TopBar title={isSubmitted ? 'Session Attendance' : 'Mark Attendance'} showBack />

      {/* Sticky Sub-Header with Counters */}
      <div className="sticky top-[53px] z-10 bg-white border-b border-gray-200 px-4 py-3 shadow-xs">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm leading-tight truncate">
              {subject?.name ?? 'Subject'}
            </h2>
            <p className="text-xs text-gray-500">
              {cls?.name}{batch ? ` (${batch.name})` : ''} · {formatDate(sessionDate)}
            </p>
          </div>
          <div>
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
        {/* Session Details / Date Picker */}
        {!isSubmitted && (
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
        {isSubmitted && (
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
                  placeholder="e.g. Roll 12 arrived late with slip"
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
        )}

        {/* Search & Bulk Toggle Controls */}
        {!isLocked && (
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
        ) : filteredStudents.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No matching students found
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
                      setAttendance(prev => ({
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
      {!isLocked && (
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
