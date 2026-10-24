import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logTimetableDiagnostic } from '../../lib/errors'
import { useAuth } from '../../hooks/useAuth'
import TopBar from '../../components/ui/TopBar'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { todayISO, todayWeekday, formatTime, WEEKDAY_FULL, formatDate } from '../../lib/utils'
import {
  BookOpen,
  AlertCircle,
  RefreshCw,
  ClipboardCheck,
  Calendar,
  AlertTriangle,
  UserX,
  ChevronRight,
} from 'lucide-react'

export default function ProfessorHome() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // 1. Fetch the professor faculty record with department details
  const {
    data: professor,
    isLoading: isProfLoading,
    isError: isProfError,
    error: profError,
    refetch: refetchProf,
  } = useQuery({
    queryKey: ['my-professor', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('professors')
        .select('*, departments(id, name)')
        .eq('user_id', profile!.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  // 2. Fetch all teaching assignments authorized for this professor
  const {
    data: assignments,
    isLoading: isAssignmentsLoading,
    isError: isAssignmentsError,
    error: assignmentsError,
    refetch: refetchAssignments,
  } = useQuery({
    queryKey: ['professor-assignments', professor?.id],
    enabled: !!professor?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select(`
          id,
          class_id,
          batch_id,
          subjects(id, name, code, type),
          classes(id, name, semester),
          batches(id, name)
        `)
        .eq('professor_id', professor!.id)
        .order('id')
      if (error) throw error
      return data ?? []
    },
  })

  const assignmentIds = useMemo(() => assignments?.map(a => a.id) ?? [], [assignments])

  // 3. Fetch today's scheduled timetable slots for this professor's assignments
  const {
    data: todaySlots,
    isLoading: isSlotsLoading,
    isError: isSlotsError,
    error: slotsError,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: ['professor-today-slots', assignmentIds],
    enabled: assignmentIds.length > 0,
    queryFn: async () => {
      const weekday = todayWeekday()
      const today = todayISO()

      const { data: slots, error: sErr } = await supabase
        .from('timetable_slots')
        .select('id, teaching_assignment_id, weekday, start_time, end_time, room')
        .in('teaching_assignment_id', assignmentIds)
        .eq('weekday', weekday)
        .order('start_time')

      if (sErr) {
        logTimetableDiagnostic('professor_today_slots', sErr, 'professor_today_slots')
        throw sErr
      }
      if (!slots || slots.length === 0) return []

      // Check if attendance session was already recorded today for each assignment
      const { data: sessions, error: sessErr } = await supabase
        .from('sessions')
        .select('id, teaching_assignment_id, status')
        .in('teaching_assignment_id', assignmentIds)
        .eq('date', today)

      if (sessErr) {
        logTimetableDiagnostic('professor_today_sessions', sessErr, 'professor_today_sessions')
        throw sessErr
      }

      const sessionMap = new Map(sessions?.map(s => [s.teaching_assignment_id, s]) ?? [])
      const assignmentMap = new Map(assignments!.map(a => [a.id, a]))

      return slots.map(slot => ({
        ...slot,
        assignment: assignmentMap.get(slot.teaching_assignment_id),
        session: sessionMap.get(slot.teaching_assignment_id) ?? null,
      }))
    },
  })

  // 4. Fetch pending draft sessions (unsubmitted drafts across all assigned subjects)
  const {
    data: draftSessions,
    isError: isDraftsError,
    error: draftsError,
    refetch: refetchDrafts,
  } = useQuery({
    queryKey: ['professor-drafts', assignmentIds],
    enabled: assignmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, teaching_assignment_id, date, session_type, status, created_at')
        .in('teaching_assignment_id', assignmentIds)
        .eq('status', 'draft')
        .order('date', { ascending: false })

      if (error) throw error
      if (!data) return []

      const assignmentMap = new Map(assignments!.map(a => [a.id, a]))
      return data.map(s => ({
        ...s,
        assignment: assignmentMap.get(s.teaching_assignment_id),
      }))
    },
  })

  const hasError = isProfError || isAssignmentsError || isSlotsError || isDraftsError
  const errorMessage =
    (profError as any)?.message ||
    (assignmentsError as any)?.message ||
    (slotsError as any)?.message ||
    (draftsError as any)?.message

  const isInitialLoading = isProfLoading || (!!professor && isAssignmentsLoading)

  const handleRetryAll = () => {
    refetchProf()
    refetchAssignments()
    refetchSlots()
    refetchDrafts()
  }

  const deptName = (professor?.departments as any)?.name

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <TopBar title="Professor Portal" showLogout />

      <div className="p-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Greeting Banner */}
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl p-5 text-white shadow-xs">
          <p className="text-sm opacity-85">Good {greeting()},</p>
          <p className="text-xl font-bold">{profile?.name ?? 'Professor'}</p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-blue-100">
            {deptName && (
              <span className="bg-white/20 backdrop-blur-xs px-2.5 py-0.5 rounded-full font-medium">
                Dept: {deptName}
              </span>
            )}
            {assignments && assignments.length > 0 && (
              <span className="bg-white/20 backdrop-blur-xs px-2.5 py-0.5 rounded-full font-medium">
                {assignments.length} Assigned {assignments.length === 1 ? 'Subject' : 'Subjects'}
              </span>
            )}
          </div>
        </div>

        {/* ─── STATE A: Query / Network Error ─── */}
        {hasError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center space-y-3 shadow-xs">
            <AlertCircle size={28} className="text-red-500 mx-auto" />
            <div>
              <p className="font-semibold text-red-900 text-sm">Failed to load portal data</p>
              <p className="text-xs text-red-600 mt-1">{errorMessage || 'Database connection error'}</p>
            </div>
            <Button size="sm" variant="outline" onClick={handleRetryAll}>
              <RefreshCw size={14} className="mr-1.5" />
              Retry
            </Button>
          </div>
        )}

        {/* ─── STATE B: Initial Loading Spinner ─── */}
        {isInitialLoading && !hasError && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <Spinner className="h-9 w-9" />
            <p className="text-xs text-gray-500">Loading your faculty schedule…</p>
          </div>
        )}

        {/* ─── STATE C: No Matching Professor Record Exists ─── */}
        {!isInitialLoading && !hasError && !professor && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3 shadow-xs">
            <div className="flex items-start gap-3">
              <UserX size={26} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="font-semibold text-amber-950 text-sm">Faculty Account Setup Required</h3>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Your login account has role <strong className="font-semibold">Professor</strong>, but has not been linked to a department in the college faculty directory yet.
                </p>
                <p className="text-xs text-amber-700 leading-relaxed pt-1">
                  Please contact a college administrator to link your account in <strong>Admin Portal &gt; Users &gt; Manage Faculty</strong>. Once linked, your assigned subjects and timetable will appear here automatically.
                </p>
              </div>
            </div>
            <div className="pt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => navigate('/professor/mark')}
              >
                Open Attendance Screen
              </Button>
              <Button size="sm" variant="ghost" onClick={handleRetryAll}>
                <RefreshCw size={13} className="mr-1" /> Refresh
              </Button>
            </div>
          </div>
        )}

        {/* ─── STATE D: Professor Exists, but No Teaching Assignments Configured ─── */}
        {!isInitialLoading && !hasError && professor && assignments?.length === 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-3 shadow-xs">
            <div className="flex items-start gap-3">
              <BookOpen size={26} className="text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="font-semibold text-blue-950 text-sm">No Teaching Assignments Assigned</h3>
                <p className="text-xs text-blue-800 leading-relaxed">
                  Your faculty profile is active in <strong className="font-semibold">{deptName || 'your department'}</strong>, but no subjects or class divisions have been assigned to you yet.
                </p>
                <p className="text-xs text-blue-700 leading-relaxed pt-1">
                  College administrators assign professors to subjects and classes in <strong>Admin Portal &gt; Teaching Assignments</strong>.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-2"
              onClick={() => navigate('/professor/mark')}
            >
              Open Attendance Screen
            </Button>
          </div>
        )}

        {/* ─── STATE E: Active Teaching Assignments Configured ─── */}
        {!isInitialLoading && !hasError && professor && (assignments?.length ?? 0) > 0 && (
          <>
            {/* Primary Action Card: Always Accessible Mark Attendance */}
            <Card
              onClick={() => navigate('/professor/mark')}
              className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-600 text-white p-2.5 rounded-xl shrink-0 shadow-xs">
                    <ClipboardCheck size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-950 text-sm">Mark Attendance</h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      Select any of your {assignments!.length} assigned subjects to record or update attendance
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs bg-blue-600 text-white font-semibold px-3 py-1.5 rounded-xl shadow-xs">
                    Start →
                  </span>
                </div>
              </div>
            </Card>

            {/* Unsubmitted Drafts Callout Banner (if any) */}
            {draftSessions && draftSessions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-600" />
                    Unsubmitted Drafts ({draftSessions.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {draftSessions.map(draft => {
                    const sub = (draft.assignment as any)?.subjects
                    const cl = (draft.assignment as any)?.classes
                    const bt = (draft.assignment as any)?.batches
                    return (
                      <Card
                        key={draft.id}
                        onClick={() => navigate(`/professor/mark?sessionId=${draft.id}`)}
                        className="border-amber-300 bg-amber-50/40 hover:bg-amber-50 hover:shadow-xs transition-all cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-gray-900 text-sm truncate">
                              {sub?.name ?? 'Subject'}
                            </p>
                            <p className="text-xs text-gray-600 mt-0.5">
                              {cl?.name}{bt ? ` · Batch: ${bt.name}` : ''} · {formatDate(draft.date)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <Badge variant="yellow">Resume Draft →</Badge>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Today's Classes (Timetable Schedule) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Today's Schedule ({WEEKDAY_FULL[todayWeekday()]})
                </h2>
              </div>

              {isSlotsLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : todaySlots && todaySlots.length > 0 ? (
                <div className="space-y-2.5">
                  {todaySlots.map(slot => {
                    const subject = (slot.assignment as any)?.subjects
                    const cls = (slot.assignment as any)?.classes
                    const batch = (slot.assignment as any)?.batches
                    const session = slot.session as any
                    const hasSession = !!session

                    return (
                      <Card
                        key={slot.id}
                        onClick={() => {
                          if (hasSession) {
                            navigate(`/professor/mark?sessionId=${session.id}`)
                          } else {
                            navigate(`/professor/mark?assignmentId=${slot.teaching_assignment_id}`)
                          }
                        }}
                        className="hover:shadow-md hover:border-blue-300 transition-all cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-gray-900 text-sm truncate">
                              {subject?.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {cls?.name}{batch ? ` · ${batch.name}` : ''} · {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                            </p>
                            {slot.room && (
                              <p className="text-xs text-gray-400 mt-0.5">Room: {slot.room}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            {hasSession ? (
                              <span
                                className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                                  session.status === 'submitted'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {session.status === 'submitted' ? 'Submitted' : 'Draft'}
                              </span>
                            ) : (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold">
                                Mark Now
                              </span>
                            )}
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-5 text-center space-y-2 shadow-2xs">
                  <Calendar size={28} className="text-gray-400 mx-auto" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">
                      No classes scheduled for today ({WEEKDAY_FULL[todayWeekday()]})
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      You can still record or update attendance for any of your assigned subjects on any permitted date.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/professor/mark')}
                  >
                    <ClipboardCheck size={14} className="mr-1.5" />
                    Mark Attendance
                  </Button>
                </div>
              )}
            </div>

            {/* All Assigned Subjects List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Your Assigned Subjects ({assignments!.length})
                </h2>
              </div>
              <div className="space-y-2">
                {assignments!.map(a => {
                  const subject = (a as any).subjects
                  const cls = (a as any).classes
                  const batch = (a as any).batches

                  return (
                    <Card
                      key={a.id}
                      onClick={() => navigate(`/professor/mark?assignmentId=${a.id}`)}
                      className="hover:shadow-md hover:border-blue-300 transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="font-semibold text-sm text-gray-900 truncate">
                              {subject?.name}
                            </p>
                            <span className="text-xs text-gray-400 font-mono">
                              {subject?.code}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                            <span className="bg-gray-100 px-2 py-0.5 rounded-md font-medium text-gray-700">
                              {cls?.name} (Sem {cls?.semester})
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md font-medium ${
                                batch
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {batch ? `Batch: ${batch.name}` : 'Theory (All Batches)'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs text-blue-600 font-medium flex items-center gap-0.5 hover:underline">
                            Mark <ChevronRight size={14} />
                          </span>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
