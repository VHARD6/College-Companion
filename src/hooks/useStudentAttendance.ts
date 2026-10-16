import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { calcPercent, classifyStatus } from '../lib/attendance'
import type { SubjectAttendanceSummary } from '../types'

/**
 * Fetches all attendance data for the current student
 * and returns per-subject summaries.
 */
export function useStudentAttendance(studentId: number | undefined, threshold: number) {
  return useQuery({
    queryKey: ['student-attendance', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      if (!studentId) return []

      // 1. Get the student's class to find their subjects
      const { data: studentData } = await supabase
        .from('students')
        .select('class_id, batch_id')
        .eq('id', studentId)
        .maybeSingle()

      if (!studentData || !studentData.class_id) return []

      // 2. Get all subjects linked to the student's class via teaching assignments
      const { data: assignments } = await supabase
        .from('teaching_assignments')
        .select('id, subjects(*), batch_id')
        .eq('class_id', studentData.class_id)

      if (!assignments || assignments.length === 0) return []

      // Filter out practical assignments that belong to a different batch
      const relevantAssignments = assignments.filter(a =>
        a.batch_id === null || a.batch_id === studentData.batch_id
      )

      // 3. For each assignment, count sessions held and student's attendance
      const summaries: SubjectAttendanceSummary[] = []

      for (const assignment of relevantAssignments) {
        const subject = assignment.subjects as any

        // Get submitted sessions for this assignment
        const { data: sessions, count: held } = await supabase
          .from('sessions')
          .select('id', { count: 'exact' })
          .eq('teaching_assignment_id', assignment.id)
          .eq('status', 'submitted')

        const h = held ?? sessions?.length ?? 0
        let a = 0

        // Only query attendance_records if at least one session has been held
        if (h > 0 && sessions && sessions.length > 0) {
          const sessionIds = sessions.map(s => s.id)
          const { count: attended } = await supabase
            .from('attendance_records')
            .select('id', { count: 'exact' })
            .eq('student_id', studentId)
            .eq('status', 'present')
            .in('session_id', sessionIds)

          a = attended ?? 0
        }

        const percent = calcPercent(a, h)

        summaries.push({
          subject,
          attended: a,
          held: h,
          percent,
          status: classifyStatus(percent, threshold) as 'safe' | 'warning' | 'danger',
        })
      }

      return summaries
    },
  })
}
