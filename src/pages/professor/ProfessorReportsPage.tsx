import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import TopBar from '../../components/ui/TopBar'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import { calcPercent } from '../../lib/attendance'

export default function ProfessorReportsPage() {
  const { profile } = useAuth()

  // Fetch current user's professor record
  const { data: professor, isLoading: profLoading } = useQuery({
    queryKey: ['my-professor', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase
        .from('professors')
        .select('id')
        .eq('user_id', profile!.id)
        .maybeSingle()
      return data
    },
  })

  // Fetch only teaching assignments for this professor
  const { data: assignments, isLoading: assignmentsLoading } = useQuery({
    queryKey: ['prof-reports', professor?.id],
    enabled: !!professor?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('teaching_assignments')
        .select('id, subjects(name, code), classes(name, semester), batches(name)')
        .eq('professor_id', professor!.id)
      return data ?? []
    },
  })

  const isLoading = profLoading || assignmentsLoading

  return (
    <div>
      <TopBar title="Reports" showBack />
      <div className="p-4 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
        ) : !professor ? (
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

  const { data, isLoading } = useQuery({
    queryKey: ['report-detail', assignment.id],
    queryFn: async () => {
      // Get all submitted sessions for this assignment
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, date')
        .eq('teaching_assignment_id', assignment.id)
        .eq('status', 'submitted')
        .order('date', { ascending: false })

      if (!sessions || sessions.length === 0) return { sessions: [], studentStats: [] }

      const sessionIds = sessions.map(s => s.id)

      // Get attendance records aggregated by student
      const { data: records } = await supabase
        .from('attendance_records')
        .select('student_id, status, students(roll_no, profiles(name))')
        .in('session_id', sessionIds)

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
      ) : data?.studentStats.length === 0 ? (
        <p className="text-xs text-gray-400">No attendance data yet</p>
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
