import { supabase } from './supabase.ts'
import type {
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
} from '../types/timetableStudio.ts'

/**
 * Projects a published master timetable into the operational `timetable_slots` table.
 * Preserves 100% backward compatibility for attendance marking workflows and professor dashboards.
 */
export async function syncMasterTimetableToSlots(
  _timetableId: number,
  periods: MasterTimetablePeriod[],
  columns: MasterTimetableColumn[],
  entries: MasterTimetableEntry[],
  client: any = supabase
): Promise<{ projectedCount: number }> {
  const periodMap = new Map<number, MasterTimetablePeriod>(periods.map(p => [p.id, p]))
  const columnMap = new Map<number, MasterTimetableColumn>(columns.map(c => [c.id, c]))

  let projectedCount = 0

  for (const entry of entries) {
    if (entry.entry_type === 'break' || !entry.column_id) continue

    const col = columnMap.get(entry.column_id)
    const pStart = periodMap.get(entry.start_period_id)
    const pEnd = periodMap.get(entry.end_period_id)

    if (!col || !pStart || !pEnd) continue

    const startTime = pStart.start_time
    const endTime = pEnd.end_time

    for (const sub of entry.subentries) {
      if (!sub.subject_id || !sub.professor_id) continue

      // 1. Locate or create teaching_assignment
      let taQuery = client
        .from('teaching_assignments')
        .select('id')
        .eq('professor_id', sub.professor_id)
        .eq('subject_id', sub.subject_id)
        .eq('class_id', col.class_id)

      if (sub.batch_id !== null && sub.batch_id !== undefined) {
        taQuery = taQuery.eq('batch_id', sub.batch_id)
      } else {
        taQuery = taQuery.is('batch_id', null)
      }

      const { data: existingTA, error: findError } = await taQuery.maybeSingle()

      if (findError) {
        console.warn('Failed to find teaching assignment during sync:', findError.message)
        continue
      }

      let assignmentId = existingTA?.id

      if (!assignmentId) {
        const { data: newTA, error: taError } = await client
          .from('teaching_assignments')
          .insert({
            professor_id: sub.professor_id,
            subject_id: sub.subject_id,
            class_id: col.class_id,
            batch_id: (sub.batch_id !== null && sub.batch_id !== undefined) ? sub.batch_id : null,
          })
          .select('id')
          .single()

        if (taError) {
          console.warn('Failed to auto-create teaching assignment during sync:', taError.message)
          continue
        }
        assignmentId = newTA.id
      }

      // 2. Check if a slot already exists with identical bounds
      const { data: existingSlot } = await client
        .from('timetable_slots')
        .select('id')
        .eq('teaching_assignment_id', assignmentId)
        .eq('weekday', entry.weekday)
        .eq('start_time', startTime)
        .eq('end_time', endTime)
        .maybeSingle()

      if (!existingSlot) {
        const { error: slotError } = await client.from('timetable_slots').insert({
          teaching_assignment_id: assignmentId,
          weekday: entry.weekday,
          start_time: startTime,
          end_time: endTime,
          room: sub.room || null,
        })

        if (!slotError) {
          projectedCount++
        }
      }
    }
  }

  return { projectedCount }
}
