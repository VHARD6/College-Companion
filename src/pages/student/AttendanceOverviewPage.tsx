import { useAuth } from '../../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import SubjectCard from '../../components/student/SubjectCard'
import Spinner from '../../components/ui/Spinner'
import { useStudentAttendance } from '../../hooks/useStudentAttendance'

const DEFAULT_THRESHOLD = 75

export default function AttendanceOverviewPage() {
  const { profile } = useAuth()

  const { data: student } = useQuery({
    queryKey: ['my-student', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase.from('students').select('*').eq('user_id', profile!.id).maybeSingle()
      return data
    },
  })

  const { data: policy } = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const { data } = await supabase.from('attendance_policy').select('*').single()
      return data
    },
  })

  const threshold = policy?.threshold_percent ?? DEFAULT_THRESHOLD
  const { data: summaries, isLoading } = useStudentAttendance(student?.id, threshold)

  return (
    <div>
      <TopBar title="My Attendance" showBack />
      <div className="p-4 space-y-3">
        {!student?.class_id && !isLoading && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="font-semibold text-amber-900 text-sm">Enrollment Pending</p>
            <p className="text-xs text-amber-700 mt-1">
              You have not been assigned to a class division yet. Attendance records will appear once your class enrollment is completed.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        ) : summaries?.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No subjects found</p>
        ) : (
          summaries?.map(s => (
            <SubjectCard key={s.subject.id} summary={s} threshold={threshold} />
          ))
        )}
      </div>
    </div>
  )
}
