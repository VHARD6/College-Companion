import type { Class, Subject, Professor, Batch } from './index'

export type MasterTimetableStatus = 'draft' | 'published' | 'archived'

export type TimetableEntryType = 'lecture' | 'practical' | 'tutorial' | 'break'

export interface MasterTimetable {
  id: number
  title: string
  academic_year: string // e.g. '2026-27'
  semester: number // 1 - 8
  cohort: string // e.g. 'TE' or 'Third Year'
  effective_date: string // YYYY-MM-DD
  status: MasterTimetableStatus
  version: number
  header_title?: string | null
  header_subtitle?: string | null
  footer_notes?: string | null
  published_png_url?: string | null
  created_by?: string | null
  published_at?: string | null
  created_at?: string
  periods?: MasterTimetablePeriod[]
  columns?: MasterTimetableColumn[]
  entries?: MasterTimetableEntry[]
}

export interface MasterTimetablePeriod {
  id: number
  timetable_id: number
  period_order: number // 1, 2, 3...
  start_time: string // HH:MM:SS or HH:MM
  end_time: string // HH:MM:SS or HH:MM
  is_break: boolean
  break_label?: string | null // e.g. 'Recess', 'Lunch Break'
}

export interface MasterTimetableColumn {
  id: number
  timetable_id: number
  class_id: number
  column_order: number
  display_label: string // e.g. 'TE Comp A (Room 401)'
  class?: Class
}

export interface MasterTimetableSubentry {
  id?: number
  entry_id?: number
  subject_id: number
  professor_id: number
  batch_id?: number | null // null if whole division attends
  room?: string | null
  subject?: Subject
  professor?: Professor & { abbreviation?: string | null }
  batch?: Batch
}

export interface MasterTimetableEntry {
  id?: number
  timetable_id: number
  weekday: number // 0 = Mon, 5 = Sat
  start_period_id: number
  end_period_id: number
  column_id?: number | null // null for common timetable-wide breaks
  entry_type: TimetableEntryType
  common_break_label?: string | null
  subentries: MasterTimetableSubentry[]
}

export type ConflictSeverity = 'error' | 'warning'

export interface TimetableConflict {
  code: string // e.g. 'VAL-01', 'VAL-02'
  severity: ConflictSeverity
  message: string
  weekday: number
  periodIds: number[]
  columnId?: number | null
  professorId?: number
  room?: string
  batchId?: number
}

export interface TimetableValidationResult {
  isValid: boolean
  hasErrors: boolean
  hasWarnings: boolean
  errors: TimetableConflict[]
  warnings: TimetableConflict[]
}
