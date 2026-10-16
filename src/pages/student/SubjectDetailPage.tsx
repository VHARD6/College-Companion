import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import TopBar from '../../components/ui/TopBar'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import { calcPercent, calcSkippable, calcNeeded } from '../../lib/attendance'
import { formatDate } from '../../lib/utils'

const DEFAULT_THRESHOLD = 75

export default function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const { profile } = useAuth()

  // Fetch subject info
  const { data: subject } = useQuery({
    queryKey: ['subject', subjectId],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('id', subjectId!).single()
      return data
    },
  })

  // Fetch the student row
  const { data: student } = useQuery({
    queryKey: ['my-student', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase.from('students').select('*').eq('user_id', profile!.id).maybeSingle()
      return data
    },
  })

  // Fetch attendance policy
  const { data: policy } = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const { data } = await supabase.from('attendance_policy').select('*').single()
      return data
    },
  })

  const threshold = policy?.threshold_percent ?? DEFAULT_THRESHOLD

  // Fetch per-session attendance records for this student + subject
  const { data: records, isLoading } = useQuery({
    queryKey: ['subject-records', subjectId, student?.id],
    enabled: !!student && !!student.class_id && !!subjectId,
    queryFn: async () => {
      if (!student?.class_id || !subjectId) return []

      // Find teaching assignments for this subject + student's class
      const { data: assignments } = await supabase
        .from('teaching_assignments')
        .select('id, batch_id')
        .eq('subject_id', subjectId)
        .eq('class_id', student.class_id)

      if (!assignments || assignments.length === 0) return []

      // Filter for general class assignments (batch_id is null) or matching student's batch
      const relevantAssignments = assignments.filter(
        a => a.batch_id === null || a.batch_id === student.batch_id
      )
      const assignmentIds = relevantAssignments.map(a => a.id)
      if (assignmentIds.length === 0) return []

      // Fetch submitted sessions for this student's assignments
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, date, session_type, status')
        .in('teaching_assignment_id', assignmentIds)
        .eq('status', 'submitted')
        .order('date', { ascending: false })

      if (!sessions || sessions.length === 0) return []

      // Fetch attendance records for these sessions
      const sessionIds = sessions.map(s => s.id)
      const { data: attendanceRows } = await supabase
        .from('attendance_records')
        .select('session_id, status')
        .eq('student_id', student.id)
        .in('session_id', sessionIds)

      // Merge: annotate each session with the student's attendance status
      const recordMap = new Map(attendanceRows?.map(r => [r.session_id, r.status]) ?? [])
      return sessions.map(s => ({
        ...s,
        attendance: recordMap.get(s.id) ?? 'absent',
      }))
    },
  })

  const held = records?.length ?? 0
  const attended = records?.filter(r => r.attendance === 'present').length ?? 0
  const percent = calcPercent(attended, held)
  const skippable = calcSkippable(attended, held, threshold)
  const needed = calcNeeded(attended, held, threshold)
  const isSafe = percent !== null && percent >= threshold

  return (
    <div>
      <TopBar title={subject?.name ?? 'Subject'} showBack />
      <div className="p-4 space-y-4">

        {/* Not enrolled in class division banner */}
        {!student?.class_id && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="font-semibold text-amber-900 text-sm">Enrollment Pending</p>
            <p className="text-xs text-amber-700 mt-1">
              You are not assigned to a class division yet. Attendance tracking will appear once your class assignment is complete.
            </p>
          </div>
        )}

        {/* Summary card */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <p className="text-xs text-gray-500 mb-1">{subject?.code} · {subject?.type}</p>
          <div className="flex items-end gap-2 mb-3">
            <span className="text-4xl font-black text-gray-900">
              {percent !== null ? `${percent}%` : '--'}
            </span>
            <span className="text-sm text-gray-500 mb-1">{attended}/{held} classes</span>
          </div>

          {/* Progress bar */}
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden relative mb-1">
            <div
              className={`h-full rounded-full ${held === 0 ? 'bg-gray-300' : isSafe ? 'bg-green-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(percent ?? 0, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">Threshold: {threshold}%</p>

          {/* Actionable insight */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            {held === 0 ? (
              <p className="text-sm text-gray-500">
                ℹ No classes have been submitted yet. Attendance metrics will calculate after your first lecture.
              </p>
            ) : isSafe ? (
              <p className="text-sm text-green-700">
                ✅ You can skip <strong>{skippable}</strong> more class{skippable !== 1 ? 'es' : ''} and stay above {threshold}%.
              </p>
            ) : (
              <p className="text-sm text-red-700">
                ⚠ You need to attend <strong>{needed}</strong> more consecutive class{needed !== 1 ? 'es' : ''} to reach {threshold}%.
              </p>
            )}
          </div>
        </div>

        {/* Session log */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Session History</h2>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-8 w-8" />
            </div>
          ) : records?.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No sessions recorded yet</p>
          ) : (
            <div className="space-y-2">
              {records?.map(record => (
                <div key={record.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{formatDate(record.date)}</p>
                    <p className="text-xs text-gray-500 capitalize">{record.session_type}</p>
                  </div>
                  <Badge variant={record.attendance === 'present' ? 'green' : 'red'}>
                    {record.attendance === 'present' ? 'Present' : 'Absent'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
