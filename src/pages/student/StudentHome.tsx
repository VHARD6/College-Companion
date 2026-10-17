import { useAuth } from '../../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import SubjectCard from '../../components/student/SubjectCard'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { useStudentAttendance } from '../../hooks/useStudentAttendance'
import { calcPercent } from '../../lib/attendance'
import { BookOpen, Calendar, AlertCircle, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

const DEFAULT_THRESHOLD = 75

export default function StudentHome() {
  const { profile } = useAuth()

  // Get the student row for the current user
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
      const { data, error } = await supabase
        .from('students')
        .select('*, classes(name, semester, academic_year), batches(name)')
        .eq('user_id', profile!.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  // Fetch policy for threshold
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

  // Overall attendance = total attended / total held across all subjects
  const overallPercent = summaries && summaries.length > 0
    ? calcPercent(
        summaries.reduce((acc, s) => acc + s.attended, 0),
        summaries.reduce((acc, s) => acc + s.held, 0)
      )
    : null

  const dangerCount = summaries?.filter(s => s.status === 'danger').length ?? 0

  const studentClass = (student as any)?.classes
  const studentBatch = (student as any)?.batches

  return (
    <div>
      <TopBar title="College Companion" showLogout />

      <div className="p-4 space-y-4">
        {/* Greeting banner */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 rounded-2xl p-5 text-white shadow-sm">
          <p className="text-sm opacity-80">Good {greeting()},</p>
          <p className="text-xl font-bold">{profile?.name}</p>

          {/* Student Academic Enrollment Info Chip */}
          {student && student.class_id && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-blue-100">
              <span className="bg-white/20 backdrop-blur-xs px-2.5 py-0.5 rounded-full font-medium">
                Roll No: {student.roll_no}
              </span>
              {studentClass && (
                <span className="bg-white/20 backdrop-blur-xs px-2.5 py-0.5 rounded-full font-medium">
                  Class: {studentClass.name} (Sem {studentClass.semester})
                </span>
              )}
              <span className="bg-white/20 backdrop-blur-xs px-2.5 py-0.5 rounded-full font-medium">
                Batch: {studentBatch?.name ?? 'General'}
              </span>
            </div>
          )}

          <div className="mt-4 flex items-end gap-1">
            <span className="text-4xl font-black">
              {overallPercent !== null ? `${overallPercent}%` : '--'}
            </span>
            <span className="text-sm opacity-80 mb-1">overall attendance</span>
          </div>
          {dangerCount > 0 && (
            <p className="mt-2 text-xs bg-white/20 rounded-lg px-3 py-1 inline-block">
              ⚠ {dangerCount} subject{dangerCount > 1 ? 's' : ''} below {threshold}%
            </p>
          )}
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-3">
          <Link to="/student/attendance" className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 shadow-sm">
            <BookOpen className="text-blue-600" size={22} />
            <span className="font-medium text-sm">Attendance</span>
          </Link>
          <Link to="/student/timetable" className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 shadow-sm">
            <Calendar className="text-blue-600" size={22} />
            <span className="font-medium text-sm">Timetable</span>
          </Link>
        </div>

        {/* Subject cards list */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Subjects</h2>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-8 w-8" />
            </div>
          ) : hasError ? (
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
          ) : !student || !student.class_id ? (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center space-y-1.5">
              <p className="font-semibold text-blue-900 text-sm">Enrollment Pending</p>
              <p className="text-xs text-blue-700 leading-relaxed">
                Your student profile is active! You have not been assigned to a class division yet.
                Please contact your college administrator to complete your class enrollment.
              </p>
            </div>
          ) : summaries?.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No subjects assigned to your class yet</p>
          ) : (
            <div className="space-y-3">
              {summaries?.map(s => (
                <SubjectCard key={s.subject.id} summary={s} threshold={threshold} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Returns 'morning', 'afternoon', or 'evening' based on current hour */
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
