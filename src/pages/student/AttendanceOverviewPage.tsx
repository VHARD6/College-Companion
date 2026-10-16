import { useAuth } from '../../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import SubjectCard from '../../components/student/SubjectCard'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { useStudentAttendance } from '../../hooks/useStudentAttendance'
import { AlertCircle, RefreshCw } from 'lucide-react'

const DEFAULT_THRESHOLD = 75

export default function AttendanceOverviewPage() {
  const { profile } = useAuth()

  const {
    data: student,
    isLoading: isStudentLoading,
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

  const {
    data: policy,
    isError: isPolicyError,
    error: policyError,
  } = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance_policy').select('*').single()
      if (error) throw error
      return data
    },
  })

  const threshold = policy?.threshold_percent ?? DEFAULT_THRESHOLD
  const {
    data: summaries,
    isLoading: isSummariesLoading,
    isError: isSummariesError,
    error: summariesError,
    refetch: refetchSummaries,
  } = useStudentAttendance(student?.id, threshold)

  const isLoading = isStudentLoading || isSummariesLoading
  const hasError = isStudentError || isPolicyError || isSummariesError
  const errorMessage =
    (studentError as any)?.message ||
    (policyError as any)?.message ||
    (summariesError as any)?.message

  return (
    <div>
      <TopBar title="My Attendance" showBack />
      <div className="p-4 space-y-3">
        {hasError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2">
            <AlertCircle size={24} className="text-red-500 mx-auto" />
            <p className="font-semibold text-red-900 text-sm">Failed to load attendance records</p>
            <p className="text-xs text-red-600">{errorMessage || 'Database query failure'}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                refetchStudent()
                refetchSummaries()
              }}
            >
              <RefreshCw size={14} className="mr-1.5" />
              Retry
            </Button>
          </div>
        )}

        {!hasError && !student?.class_id && !isLoading && (
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
        ) : hasError ? null : summaries?.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No subjects found for your class division</p>
        ) : (
          summaries?.map(s => (
            <SubjectCard key={s.subject.id} summary={s} threshold={threshold} />
          ))
        )}
      </div>
    </div>
  )
}
