import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import TopBar from '../../components/ui/TopBar'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { calcPercent } from '../../lib/attendance'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function ProfessorReportsPage() {
  const { profile } = useAuth()

  // Fetch current user's professor record
  const {
    data: professor,
    isLoading: profLoading,
    isError: isProfError,
    error: profError,
    refetch: refetchProf,
  } = useQuery({
    queryKey: ['my-professor', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('professors')
        .select('id')
        .eq('user_id', profile!.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  // Fetch only teaching assignments for this professor
  const {
    data: assignments,
    isLoading: assignmentsLoading,
    isError: isAssignmentsError,
    error: assignmentsError,
    refetch: refetchAssignments,
  } = useQuery({
    queryKey: ['prof-reports', professor?.id],
    enabled: !!professor?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select('id, subjects(name, code), classes(name, semester), batches(name)')
        .eq('professor_id', professor!.id)
      if (error) throw error
      return data ?? []
    },
  })

  const isLoading = profLoading || assignmentsLoading
  const hasError = isProfError || isAssignmentsError
  const errorMessage = (profError as any)?.message || (assignmentsError as any)?.message

  return (
    <div>
      <TopBar title="Reports" showBack />
      <div className="p-4 space-y-4">
        {hasError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2">
            <AlertCircle size={24} className="text-red-500 mx-auto" />
            <p className="font-semibold text-red-900 text-sm">Failed to load reports</p>
            <p className="text-xs text-red-600">{errorMessage || 'Database query error'}</p>
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
        )}

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
        ) : hasError ? null : !professor ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="font-semibold text-amber-900 text-sm">Professor Record Missing</p>
            <p className="text-xs text-amber-700 mt-1">
              Your account has not been assigned a professor department record yet. Please contact the administrator.
            </p>
          </div>
        ) : assignments?.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No teaching assignments assigned to your profile yet.
          </div>
        ) : (
          assignments?.map(a => (
            <AssignmentReport key={a.id} assignment={a} />
          ))
        )}
      </div>
    </div>
  )
}

/** Per-assignment attendance report summary */
function AssignmentReport({ assignment }: { assignment: any }) {
  const subject = assignment.subjects
  const cls = assignment.classes
  const batch = assignment.batches

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-detail', assignment.id],
    queryFn: async () => {
      // Get all submitted sessions for this assignment
      const { data: sessions, error: sErr } = await supabase
        .from('sessions')
        .select('id, date')
        .eq('teaching_assignment_id', assignment.id)
        .eq('status', 'submitted')
        .order('date', { ascending: false })

      if (sErr) throw sErr
      if (!sessions || sessions.length === 0) return { sessions: [], studentStats: [] }

      const sessionIds = sessions.map(s => s.id)

      // Get attendance records aggregated by student
      const { data: records, error: rErr } = await supabase
        .from('attendance_records')
        .select('student_id, status, students(roll_no, profiles(name))')
        .in('session_id', sessionIds)

      if (rErr) throw rErr
      if (!records) return { sessions, studentStats: [] }

      // Group by student
      const byStudent = new Map<number, { name: string; rollNo: string; present: number; total: number }>()
      for (const r of records) {
        const sid = r.student_id
        const student = (r as any).students
        if (!byStudent.has(sid)) {
          byStudent.set(sid, {
            name: student?.profiles?.name ?? 'Unknown',
            rollNo: student?.roll_no ?? '',
            present: 0,
            total: 0,
          })
        }
        const entry = byStudent.get(sid)!
        entry.total++
        if (r.status === 'present') entry.present++
      }

      const studentStats = [...byStudent.values()].sort((a, b) => a.rollNo.localeCompare(b.rollNo))

      return { sessions, studentStats }
    },
  })

  const totalSessions = data?.sessions.length ?? 0

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      <p className="font-semibold text-gray-900">{subject?.name}</p>
      <p className="text-xs text-gray-500 mb-3">
        {cls?.name} · Sem {cls?.semester}
        {batch ? ` · ${batch.name}` : ''} · {totalSessions} sessions
      </p>

      {isLoading ? (
        <Spinner className="h-6 w-6" />
      ) : isError ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-center space-y-1">
          <p className="text-xs text-red-700">Failed to load statistics: {(error as any)?.message}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-blue-600 font-medium hover:underline inline-flex items-center gap-1"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : data?.studentStats.length === 0 ? (
        <p className="text-xs text-gray-400">No attendance data recorded yet</p>
      ) : (
        <div className="space-y-2">
          {data?.studentStats.map(student => {
            const percent = calcPercent(student.present, student.total)
            const status = percent === null ? 'gray' : percent >= 75 ? 'green' : percent >= 65 ? 'yellow' : 'red'
            return (
              <div key={student.rollNo} className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-900">{student.name}</p>
                  <p className="text-xs text-gray-500">{student.rollNo}</p>
                </div>
                <div className="text-right">
                  <Badge variant={status as any}>
                    {percent !== null ? `${percent}%` : 'N/A'}
                  </Badge>
                  <p className="text-xs text-gray-400 mt-0.5">{student.present}/{student.total}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
