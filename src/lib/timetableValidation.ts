import type {
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
  TimetableConflict,
  TimetableValidationResult,
} from '../types/timetableStudio'

interface ValidationContext {
  periods: MasterTimetablePeriod[]
  columns: MasterTimetableColumn[]
  entries: MasterTimetableEntry[]
  professorsById?: Map<number, { name?: string; abbreviation?: string | null }>
  batchesByClassId?: Map<number, number[]> // class_id -> batch_ids
}

/**
 * Checks whether two period ranges overlap.
 * Period ranges are defined by order indices [startOrder, endOrder].
 */
export function doPeriodsOverlap(
  periodMap: Map<number, MasterTimetablePeriod>,
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  const pStartA = periodMap.get(startA)
  const pEndA = periodMap.get(endA)
  const pStartB = periodMap.get(startB)
  const pEndB = periodMap.get(endB)

  if (!pStartA || !pEndA || !pStartB || !pEndB) return false

  const minA = Math.min(pStartA.period_order, pEndA.period_order)
  const maxA = Math.max(pStartA.period_order, pEndA.period_order)
  const minB = Math.min(pStartB.period_order, pEndB.period_order)
  const maxB = Math.max(pStartB.period_order, pEndB.period_order)

  return Math.max(minA, minB) <= Math.min(maxA, maxB)
}

/**
 * Validates a master timetable draft against all institutional rules.
 * Pure function: no database calls, fully unit-testable.
 */
export function validateMasterTimetable(context: ValidationContext): TimetableValidationResult {
  const periods = context?.periods ?? []
  const columns = context?.columns ?? []
  const entries = context?.entries ?? []
  const professorsById = context?.professorsById ?? new Map()
  const batchesByClassId = context?.batchesByClassId ?? new Map()

  const errors: TimetableConflict[] = []
  const warnings: TimetableConflict[] = []

  const periodMap = new Map<number, MasterTimetablePeriod>(periods.map(p => [p.id, p]))
  const columnMap = new Map<number, MasterTimetableColumn>(columns.map(c => [c.id, c]))

  // 1. Check VAL-05: Time Discontinuity in Periods
  const sortedPeriods = [...periods].sort((a, b) => a.period_order - b.period_order)
  for (let i = 0; i < sortedPeriods.length - 1; i++) {
    const current = sortedPeriods[i]
    const next = sortedPeriods[i + 1]
    if (current.end_time && next.start_time && current.end_time !== next.start_time) {
      warnings.push({
        code: 'VAL-05',
        severity: 'warning',
        message: `Time gap between Period ${current.period_order} (${current.end_time}) and Period ${next.period_order} (${next.start_time}).`,
        weekday: -1,
        periodIds: [current.id, next.id],
      })
    }
  }

  // Group entries by weekday for conflict detection
  const entriesByDay = new Map<number, MasterTimetableEntry[]>()
  for (const entry of entries) {
    const day = entry.weekday
    if (!entriesByDay.has(day)) {
      entriesByDay.set(day, [])
    }
    entriesByDay.get(day)!.push(entry)
  }

  // Iterate by day
  for (const [weekday, dayEntries] of entriesByDay.entries()) {
    // Flatten subentries with period bounds for fast pairwise cross-checking
    interface FlatSubentry {
      entryId: number | undefined
      entryIndex: number
      columnId: number | null | undefined
      classId?: number
      startPeriodId: number
      endPeriodId: number
      entryType: string
      subjectId: number
      professorId: number
      batchId: number | null | undefined
      room: string | null | undefined
    }

    const flatList: FlatSubentry[] = []

    for (let entryIdx = 0; entryIdx < dayEntries.length; entryIdx++) {
      const entry = dayEntries[entryIdx]
      if (entry.entry_type === 'break') continue

      const col = entry.column_id ? columnMap.get(entry.column_id) : undefined

      for (const sub of (entry.subentries || [])) {
        flatList.push({
          entryId: entry.id,
          entryIndex: entryIdx,
          columnId: entry.column_id,
          classId: col?.class_id,
          startPeriodId: entry.start_period_id,
          endPeriodId: entry.end_period_id,
          entryType: entry.entry_type,
          subjectId: sub.subject_id,
          professorId: sub.professor_id,
          batchId: sub.batch_id,
          room: sub.room?.trim() || null,
        })

        // Check VAL-06: Missing Professor Abbreviation
        if (sub.professor_id) {
          const prof = professorsById.get(sub.professor_id)
          if (!prof?.abbreviation || prof.abbreviation.trim() === '') {
            const profName = prof?.name || `Professor #${sub.professor_id}`
            errors.push({
              code: 'VAL-06',
              severity: 'error',
              message: `${profName} does not have an explicit faculty abbreviation (e.g. [KVK]).`,
              weekday,
              periodIds: [entry.start_period_id, entry.end_period_id],
              columnId: entry.column_id,
              professorId: sub.professor_id,
            })
          }
        }
      }

      // Check VAL-04: Unassigned Practical Batch
      if (entry.entry_type === 'practical' && col?.class_id) {
        const classBatches = batchesByClassId.get(col.class_id)
        if (classBatches && classBatches.length > 0) {
          const scheduledBatches = new Set(entry.subentries.map(s => s.batch_id).filter(Boolean))
          const missingBatches = classBatches.filter((bId: number) => !scheduledBatches.has(bId))
          if (missingBatches.length > 0 && scheduledBatches.size > 0) {
            warnings.push({
              code: 'VAL-04',
              severity: 'warning',
              message: `${col.display_label} has ${missingBatches.length} batch(es) unscheduled during this practical block.`,
              weekday,
              periodIds: [entry.start_period_id, entry.end_period_id],
              columnId: entry.column_id,
            })
          }
        }
      }
    }

    // Pairwise conflict checks across all flat subentries for this day
    for (let i = 0; i < flatList.length; i++) {
      for (let j = i + 1; j < flatList.length; j++) {
        const a = flatList[i]
        const b = flatList[j]

        // Do periods overlap?
        const overlap = doPeriodsOverlap(periodMap, a.startPeriodId, a.endPeriodId, b.startPeriodId, b.endPeriodId)
        if (!overlap) continue

        const isSameEntry = a.entryId !== undefined && b.entryId !== undefined
          ? a.entryId === b.entryId
          : a.entryIndex === b.entryIndex

        // VAL-01: Professor Double-Booking
        if (a.professorId && b.professorId && a.professorId === b.professorId) {
          // If they belong to the exact same entry and batch, ignore
          const sameBatch = a.batchId && b.batchId && a.batchId === b.batchId
          if (!(isSameEntry && sameBatch)) {
            const prof = professorsById.get(a.professorId)
            const profLabel = prof?.abbreviation ? `[${prof.abbreviation}] ${prof.name}` : prof?.name || `Prof #${a.professorId}`
            const colA = a.columnId ? columnMap.get(a.columnId)?.display_label : 'Branch A'
            const colB = b.columnId ? columnMap.get(b.columnId)?.display_label : 'Branch B'

            errors.push({
              code: 'VAL-01',
              severity: 'error',
              message: `Professor conflict: ${profLabel} is scheduled concurrently in ${colA} and ${colB}.`,
              weekday,
              periodIds: [a.startPeriodId, b.startPeriodId],
              columnId: a.columnId,
              professorId: a.professorId,
            })
          }
        }

        // VAL-02: Room Double-Booking
        if (a.room && b.room && a.room.toLowerCase() === b.room.toLowerCase()) {
          // Same room cannot host two different sessions concurrently
          const colA = a.columnId ? columnMap.get(a.columnId)?.display_label : 'Branch A'
          const colB = b.columnId ? columnMap.get(b.columnId)?.display_label : 'Branch B'
          if (a.columnId !== b.columnId || (!isSameEntry || a.batchId !== b.batchId)) {
            errors.push({
              code: 'VAL-02',
              severity: 'error',
              message: `Room conflict: Room "${a.room}" is assigned simultaneously in ${colA} and ${colB}.`,
              weekday,
              periodIds: [a.startPeriodId, b.startPeriodId],
              columnId: a.columnId,
              room: a.room,
            })
          }
        }

        // VAL-03: Batch Overlap
        if (a.classId && b.classId && a.classId === b.classId) {
          if (a.batchId && b.batchId && a.batchId === b.batchId && !isSameEntry) {
            errors.push({
              code: 'VAL-03',
              severity: 'error',
              message: `Batch conflict: Batch #${a.batchId} is scheduled in multiple overlapping sessions.`,
              weekday,
              periodIds: [a.startPeriodId, b.startPeriodId],
              columnId: a.columnId,
              batchId: a.batchId,
            })
          }
        }
      }
    }
  }

  // Deduplicate errors and warnings by code + message + weekday
  const dedup = (list: TimetableConflict[]) => {
    const seen = new Set<string>()
    return list.filter(item => {
      const key = `${item.code}|${item.weekday}|${item.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const cleanErrors = dedup(errors)
  const cleanWarnings = dedup(warnings)

  return {
    isValid: cleanErrors.length === 0,
    hasErrors: cleanErrors.length > 0,
    hasWarnings: cleanWarnings.length > 0,
    errors: cleanErrors,
    warnings: cleanWarnings,
  }
}
