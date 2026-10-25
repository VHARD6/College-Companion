export interface TimetablePeriodDef {
  id: number
  startTime: string // e.g. "08.00"
  endTime: string   // e.g. "09.00"
  isBreak?: boolean
  breakLabel?: string // e.g. "Short Break" or "Long Break"
}

export interface TimetablePracticalBatch {
  subject: string
  profAbbr: string
  room: string
}

export interface TimetableCellData {
  type: 'theory' | 'practical' | 'break' | 'empty'
  subject?: string
  professorAbbr?: string
  room?: string
  rowSpan?: number // e.g. 2 for 2-hour practical blocks
  batch1?: TimetablePracticalBatch
  batch2?: TimetablePracticalBatch
  text?: string // custom text or dash "-"
}

export interface CoordinatorInfo {
  branch: string
  name: string
}

export interface PracticalNotes {
  batch1Roll: string // "Roll No. 1 to 33."
  batch2Roll: string // "Roll no. 34 & Onwords."
}

export interface MasterTimetableGridData {
  academicYear: string // e.g. "2026-27"
  semester: string     // e.g. "I"
  className: string    // e.g. "FY BTECH"
  date: string         // e.g. "22/10/2026" or "2026-10-22"
  branches: string[]   // ["CSE:AIML", "ENTC", "COMP", "IT"]
  periods: TimetablePeriodDef[]
  cells: Record<string, TimetableCellData> // key: `${periodId}_${branchIndex}`
  coordinators: CoordinatorInfo[]
  practicalNotes: PracticalNotes
}

export interface PublishedMasterTimetable {
  id: number
  timetable_date: string // YYYY-MM-DD
  academic_year: string
  semester: number
  class_name: string
  image_url: string
  storage_path?: string | null
  announcement?: string | null
  grid_data?: MasterTimetableGridData | null
  published_at: string
  published_by?: string | null
  created_at: string
}
