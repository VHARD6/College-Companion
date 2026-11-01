import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { computeSubjectAttendanceSummaries } from '../lib/attendance'
import type { SubjectAttendanceSummary } from '../types'

/**
 * Fetches all attendance data for the current student
 * and returns per-subject summaries.
 * Optimized to execute in constant O(1) batched database queries,
 * eliminating the client-side N+1 query loop.
 */
export function useStudentAttendance(studentId: number | undefined, threshold: number) {
  return useQuery<SubjectAttendanceSummary[]>({
    queryKey: ['student-attendance', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      if (!studentId) return []

      // 1. Get the student's class to find their subjects
      const { data: studentData, error: sErr } = await supabase
        .from('students')
        .select('class_id, batch_id')
        .eq('id', studentId)
        .maybeSingle()

      if (sErr) throw sErr
      if (!studentData || !studentData.class_id) return []

      // 2. Get all subjects linked to the student's class via teaching assignments
      const { data: assignments, error: aErr } = await supabase
        .from('teaching_assignments')
        .select('id, subjects(*), batch_id')
        .eq('class_id', studentData.class_id)

      if (aErr) throw aErr
      if (!assignments || assignments.length === 0) return []

      // Filter out practical assignments that belong to a different batch
      const relevantAssignments = assignments.filter(a =>
        a.batch_id === null || a.batch_id === studentData.batch_id
      )

      const assignmentIds = relevantAssignments.map(a => a.id)
      if (assignmentIds.length === 0) return []

      // 3. Batched fetch: all submitted sessions for all relevant assignments in 1 query
      const { data: allSessions, error: sessErr } = await supabase
        .from('sessions')
        .select('id, teaching_assignment_id')
        .in('teaching_assignment_id', assignmentIds)
        .eq('status', 'submitted')

      if (sessErr) throw sessErr

      const sessions = allSessions ?? []
      const sessionIds = sessions.map(s => s.id)

      // 4. Batched fetch: all present attendance records for this student in 1 query
      let presentRecords: Array<{ session_id: number; status: string }> = []
      if (sessionIds.length > 0) {
        const { data: records, error: arErr } = await supabase
          .from('attendance_records')
          .select('session_id, status')
          .eq('student_id', studentId)
          .eq('status', 'present')
          .in('session_id', sessionIds)

        if (arErr) throw arErr
        presentRecords = records ?? []
      }

      // 5. In-memory summary aggregation (O(1) database queries)
      return computeSubjectAttendanceSummaries(
        relevantAssignments,
        sessions,
        presentRecords,
        threshold
      )
    },
  })
}
