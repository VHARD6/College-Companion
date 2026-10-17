// ─── Database row types (mirror the Supabase schema) ───────────────────────

export type Role = 'student' | 'professor' | 'admin'
export type AttendanceStatus = 'present' | 'absent'
export type SessionStatus = 'draft' | 'submitted' | 'cancelled'
export type SubjectType = 'theory' | 'practical' | 'tutorial'
export type SessionType = 'lecture' | 'practical' | 'tutorial'

export interface Profile {
  id: string
  name: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface Department {
  id: number
  name: string
}

export interface Class {
  id: number
  department_id: number
  name: string
  semester: number
  academic_year: string
  departments?: Department
}

export interface Batch {
  id: number
  class_id: number
  name: string
  classes?: Class
}

export interface Subject {
  id: number
  name: string
  code: string
  department_id: number
  semester: number
  type: SubjectType
  departments?: Department
}

export interface Professor {
  id: number
  user_id: string
  department_id: number
  profiles?: Profile
  departments?: Department
}

export interface Student {
  id: number
  user_id: string
  roll_no: string
  class_id: number
  batch_id: number | null
  profiles?: Profile
  classes?: Class
  batches?: Batch
}

export interface TeachingAssignment {
  id: number
  professor_id: number
  subject_id: number
  class_id: number
  batch_id: number | null
  subjects?: Subject
  classes?: Class
  batches?: Batch
  professors?: Professor
}

export interface TimetableSlot {
  id: number
  teaching_assignment_id: number
  weekday: number  // 0 = Monday
  start_time: string
  end_time: string
  room: string | null
  teaching_assignments?: TeachingAssignment
}

export interface Session {
  id: number
  teaching_assignment_id: number
  date: string
  start_time: string | null
  session_type: SessionType
  status: SessionStatus
  submitted_at: string | null
  submitted_by: string | null
  created_at: string
  teaching_assignments?: TeachingAssignment
}

export interface AttendanceRecord {
  id: number
  session_id: number
  student_id: number
  status: AttendanceStatus
  marked_by: string | null
  marked_at: string
  students?: Student
}

export interface AuditLogEntry {
  id: number
  record_id: number
  old_status: AttendanceStatus | null
  new_status: AttendanceStatus
  changed_by: string
  changed_at: string
  reason: string
  profiles?: Profile
}

export interface AttendancePolicy {
  id: number
  threshold_percent: number
  correction_window_hrs: number
}

// ─── Derived / UI types ────────────────────────────────────────────────────

/** Per-subject attendance summary for the student dashboard */
export interface SubjectAttendanceSummary {
  subject: Subject
  attended: number
  held: number
  percent: number | null  // null if held === 0
  status: 'safe' | 'warning' | 'danger'  // relative to threshold
}
