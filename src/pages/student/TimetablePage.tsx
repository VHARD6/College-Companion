import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logTimetableDiagnostic } from '../../lib/errors'
import TopBar from '../../components/ui/TopBar'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { WEEKDAY_FULL, formatTime, todayWeekday } from '../../lib/utils'
import { AlertCircle, RefreshCw, Calendar, FileText, Printer } from 'lucide-react'
import TimetablePrintDocument from '../../components/timetable/TimetablePrintDocument'
import { fetchPublishedMasterTimetableForStudent } from '../../lib/timetablePersistence'
import type { Subject, Batch } from '../../types'

export default function TimetablePage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState<'schedule' | 'master'>('schedule')

  const {
    data: student,
    isError: isStudentError,
    error: studentError,
    refetch: refetchStudent,
  } = useQuery({
    queryKey: ['my-student', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*').eq('user_id', profile!.id).maybeSingle()
      if (error) {
        logTimetableDiagnostic('student_enrollment', error, 'student_enrollment')
        const err: any = new Error(error.message)
        err.stage = 'student_enrollment'
        err.code = error.code
        err.details = error.details
        err.hint = error.hint
        throw err
      }
      return data
    },
  })

  // Fetch timetable slots for the student's class
  const {
    data: slots,
    isLoading,
    isError: isSlotsError,
    error: slotsError,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: ['timetable', student?.class_id, student?.batch_id],
    enabled: !!student && !!student.class_id,
    queryFn: async () => {
      if (!student?.class_id) return []

      const assignmentIds = await getAssignmentIds(student.class_id, student.batch_id)
      if (assignmentIds.length === 0) return []

      const { data, error } = await supabase
        .from('timetable_slots')
        .select(`
          *,
          teaching_assignments(
            subjects(name, code, type),
            professors(id, departments(name))
          )
        `)
        .in('teaching_assignment_id', assignmentIds)
        .order('weekday')
        .order('start_time')

      if (error) {
        logTimetableDiagnostic('timetable_slots', error, 'timetable_slots')
        const err: any = new Error(error.message)
        err.stage = 'timetable_slots'
        err.code = error.code
        err.details = error.details
        err.hint = error.hint
        throw err
      }
      return data ?? []
    },
  })

  // Distinguish the failing operation clearly without combining/masking
  const activeError = isStudentError ? studentError : isSlotsError ? slotsError : null
  const hasError = !!activeError

  const errorStage = (activeError as any)?.stage ?? (isStudentError ? 'student_enrollment' : 'timetable_slots')
  const stageDescription = {
    student_enrollment: 'Loading student enrollment record (students table)',
    teaching_assignments: 'Loading teaching assignments (teaching_assignments table)',
    timetable_slots: 'Loading timetable slots & embedded relations (timetable_slots query)',
  }[errorStage as 'student_enrollment' | 'teaching_assignments' | 'timetable_slots'] ?? 'Loading timetable'

  const errorCode = (activeError as any)?.code
  const errorDetails = (activeError as any)?.details
  const errorHint = (activeError as any)?.hint
  const errorMessage = (activeError as any)?.message || 'Database query error'

  const today = todayWeekday()

  // Master Timetable Query for student's class
  const {
    data: publishedMaster,
    isLoading: isMasterLoading,
    isError: isMasterError,
    error: masterError,
    refetch: refetchMaster,
  } = useQuery({
    queryKey: ['published-master-timetable', student?.class_id],
    enabled: !!student?.class_id,
    queryFn: async () => {
      try {
        return await fetchPublishedMasterTimetableForStudent(student!.class_id)
      } catch (err: any) {
        if (
          err?.code === 'PGRST205' ||
          err?.message?.toLowerCase().includes('master_timetables')
        ) {
          return null
        }
        throw err
      }
    },
    retry: false,
  })

  // Reference queries for master timetable display
  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ['subjects-master-student'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*')
      return data ?? []
    },
  })

  const { data: professors = [] } = useQuery<any[]>({
    queryKey: ['professors-master-student'],
    queryFn: async () => {
      const { data } = await supabase
        .from('professors')
        .select('id, user_id, department_id, abbreviation, departments(name)')
      return data ?? []
    },
  })

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ['batches-master-student', student?.class_id],
    enabled: !!student?.class_id,
    queryFn: async () => {
      const { data } = await supabase.from('batches').select('*').eq('class_id', student!.class_id)
      return data ?? []
    },
  })

  // Group slots by weekday
  const byDay = WEEKDAY_FULL.map((day, idx) => ({
    day,
    idx,
    slots: slots?.filter(s => s.weekday === idx) ?? [],
  }))

  return (
    <div className="pb-16">
      <TopBar title="Timetable" showBack />

      {/* Tab Switcher: My Schedule vs Master Timetable */}
      <div className="px-4 pt-3">
        <div className="flex bg-gray-200/80 p-1 rounded-xl max-w-sm mx-auto">
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'schedule'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Calendar size={14} />
            My Schedule
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('master')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'master'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText size={14} />
            Master Timetable
          </button>
        </div>
      </div>

      {activeTab === 'master' ? (
        <div className="p-4 space-y-4 max-w-4xl mx-auto">
          {isMasterLoading ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-100 shadow-xs">
              <Spinner className="h-8 w-8 text-blue-600 mb-2" />
              <p className="text-xs text-gray-500 font-medium">Loading published master timetable...</p>
            </div>
          ) : isMasterError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-3">
              <AlertCircle size={24} className="text-red-500 mx-auto" />
              <div>
                <h4 className="font-bold text-red-900 text-sm">Failed to load master timetable</h4>
                <p className="text-xs text-red-600 mt-1">
                  {(masterError as any)?.message || 'Database query error'}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetchMaster()}>
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </div>
          ) : !publishedMaster ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-200 shadow-xs space-y-3">
              <div className="bg-blue-50 text-blue-600 p-3 rounded-2xl w-fit mx-auto">
                <Calendar size={28} />
              </div>
              <div>
                <h4 className="font-bold text-gray-900 text-sm">No Published Master Timetable</h4>
                <p className="text-xs text-gray-500 max-w-md mx-auto mt-1">
                  The academic department has not yet published an official master timetable for your division.
                  Check the <strong>My Schedule</strong> tab to view your operational weekly class schedule.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetchMaster()} className="text-xs">
                <RefreshCw size={14} className="mr-1.5" />
                Check for Updates
              </Button>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900 text-sm">{publishedMaster.title}</h3>
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Published (v{publishedMaster.version})
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    With Effect From: {publishedMaster.effective_date} · Semester {publishedMaster.semester}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                >
                  <Printer size={14} /> Print / Save PDF
                </Button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-xs bg-white">
                <TimetablePrintDocument
                  timetable={publishedMaster}
                  periods={publishedMaster.periods || []}
                  columns={publishedMaster.columns || []}
                  entries={publishedMaster.entries || []}
                  selectedWeekday={today}
                  subjects={subjects}
                  professors={professors}
                  batches={batches}
                />
              </div>
            </>
          )}
        </div>
      ) : (
      <div className="p-4 space-y-4">
        {hasError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle size={20} className="text-red-500 shrink-0" />
              <p className="font-semibold text-sm">Failed to load timetable</p>
            </div>

            <div className="bg-white/90 rounded-xl p-3 border border-red-100 space-y-1.5 text-left text-xs">
              <div>
                <span className="font-semibold text-gray-700">Failed Operation: </span>
                <span className="font-medium text-red-700">{stageDescription}</span>
              </div>
              {errorCode && (
                <div>
                  <span className="font-semibold text-gray-700">PostgreSQL / API Code: </span>
                  <span className="font-mono text-gray-900 bg-gray-100 px-1 py-0.5 rounded">{errorCode}</span>
                </div>
              )}
              <div>
                <span className="font-semibold text-gray-700">Message: </span>
                <span className="text-red-600">{errorMessage}</span>
              </div>
              {errorDetails && (
                <div>
                  <span className="font-semibold text-gray-700">Details: </span>
                  <span className="text-gray-600 font-mono text-[11px]">{errorDetails}</span>
                </div>
              )}
              {errorHint && (
                <div>
                  <span className="font-semibold text-gray-700">Hint: </span>
                  <span className="text-gray-600 font-mono text-[11px]">{errorHint}</span>
                </div>
              )}
            </div>

            <div className="text-center pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (isStudentError) refetchStudent()
                  if (isSlotsError) refetchSlots()
                }}
              >
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {!hasError && !student?.class_id && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="font-semibold text-amber-900 text-sm">Enrollment Pending</p>
            <p className="text-xs text-amber-700 mt-1">
              You are not assigned to a class division yet. Your timetable will be available here once your class is assigned.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        ) : hasError ? null : (
          byDay.map(({ day, idx, slots: daySlots }) => (
            <div key={day}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className={`text-sm font-semibold ${idx === today ? 'text-blue-600' : 'text-gray-500'} uppercase tracking-wide`}>
                  {day}
                </h2>
                {idx === today && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Today</span>
                )}
              </div>

              {daySlots.length === 0 ? (
                <p className="text-xs text-gray-400 ml-1 mb-2">No classes</p>
              ) : (
                <div className="space-y-2">
                  {daySlots.map(slot => {
                    const ta = slot.teaching_assignments as any
                    const subject = ta?.subjects
                    const profDept = ta?.professors?.departments?.name
                    const profDisplayName = ta?.professors?.profiles?.name || (profDept ? `Faculty (${profDept})` : 'Faculty')
                    return (
                      <div key={slot.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                        {/* Time column */}
                        <div className="text-center min-w-[56px]">
                          <p className="text-xs font-bold text-gray-700">{formatTime(slot.start_time)}</p>
                          <p className="text-xs text-gray-400">{formatTime(slot.end_time)}</p>
                        </div>
                        <div className="w-px h-8 bg-gray-200" />
                        {/* Subject info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate">{subject?.name}</p>
                          <p className="text-xs text-gray-500">{profDisplayName} · {slot.room ?? 'Room TBA'}</p>
                        </div>
                        {/* Subject type badge */}
                        <span className="text-xs text-gray-400 capitalize">{subject?.type}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      )}
    </div>
  )
}

/** Get all teaching assignment IDs for a class (and optionally batch) */
async function getAssignmentIds(classId: number, batchId: number | null): Promise<number[]> {
  if (!classId) return []
  const query = supabase
    .from('teaching_assignments')
    .select('id, batch_id')
    .eq('class_id', classId)

  const { data, error } = await query
  if (error) {
    logTimetableDiagnostic('teaching_assignments', error, 'teaching_assignments')
    const err: any = new Error(error.message)
    err.stage = 'teaching_assignments'
    err.code = error.code
    err.details = error.details
    err.hint = error.hint
    throw err
  }
  if (!data) return []
  // Include assignments with no batch, or assignments matching this student's batch
  return data
    .filter(a => a.batch_id === null || a.batch_id === batchId)
    .map(a => a.id)
}
