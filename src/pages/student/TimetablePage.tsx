import { useAuth } from '../../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { WEEKDAY_FULL, formatTime, todayWeekday } from '../../lib/utils'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function TimetablePage() {
  const { profile } = useAuth()

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
      if (error) throw error
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
            professors(profiles(name))
          )
        `)
        .in('teaching_assignment_id', assignmentIds)
        .order('weekday')
        .order('start_time')

      if (error) throw error
      return data ?? []
    },
  })

  const hasError = isStudentError || isSlotsError
  const errorMessage = (studentError as any)?.message || (slotsError as any)?.message

  const today = todayWeekday()

  // Group slots by weekday
  const byDay = WEEKDAY_FULL.map((day, idx) => ({
    day,
    idx,
    slots: slots?.filter(s => s.weekday === idx) ?? [],
  }))

  return (
    <div>
      <TopBar title="Timetable" showBack />
      <div className="p-4 space-y-4">
        {hasError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2">
            <AlertCircle size={24} className="text-red-500 mx-auto" />
            <p className="font-semibold text-red-900 text-sm">Failed to load timetable</p>
            <p className="text-xs text-red-600">{errorMessage || 'Database query error'}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                refetchStudent()
                refetchSlots()
              }}
            >
              <RefreshCw size={14} className="mr-1.5" />
              Retry
            </Button>
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
                    const subject = (slot.teaching_assignments as any)?.subjects
                    const professor = (slot.teaching_assignments as any)?.professors?.profiles
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
                          <p className="text-xs text-gray-500">{professor?.name ?? 'TBA'} · {slot.room ?? 'Room TBA'}</p>
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
  if (error) throw error
  if (!data) return []
  // Include assignments with no batch, or assignments matching this student's batch
  return data
    .filter(a => a.batch_id === null || a.batch_id === batchId)
    .map(a => a.id)
}
