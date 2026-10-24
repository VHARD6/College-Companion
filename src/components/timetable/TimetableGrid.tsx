import type {
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
  TimetableValidationResult,
} from '../../types/timetableStudio'
import type { Subject, Professor, Batch } from '../../types'
import { Plus, AlertCircle, Coffee, FlaskConical, BookOpen, GraduationCap } from 'lucide-react'

interface Props {
  periods: MasterTimetablePeriod[]
  columns: MasterTimetableColumn[]
  entries: MasterTimetableEntry[]
  currentWeekday: number
  validation?: TimetableValidationResult
  subjects: Subject[]
  professors: (Professor & { abbreviation?: string | null })[]
  batches: Batch[]
  onCellClick: (column: MasterTimetableColumn, period: MasterTimetablePeriod, existingEntry?: MasterTimetableEntry) => void
  onFullWidthBreakClick?: (period: MasterTimetablePeriod, existingEntry?: MasterTimetableEntry) => void
}

export default function TimetableGrid({
  periods,
  columns,
  entries,
  currentWeekday,
  validation,
  subjects,
  professors,
  batches,
  onCellClick,
  onFullWidthBreakClick,
}: Props) {
  const subjectMap = new Map<number, Subject>(subjects.map(s => [s.id, s]))
  const profMap = new Map<number, Professor & { abbreviation?: string | null }>(
    professors.map(p => [p.id, p])
  )
  const batchMap = new Map<number, Batch>(batches.map(b => [b.id, b]))
  const periodMap = new Map<number, MasterTimetablePeriod>(periods.map(p => [p.id, p]))

  // Filter entries for the current weekday
  const dayEntries = entries.filter(e => e.weekday === currentWeekday)

  // Track spanned cells so we don't render duplicate <td> elements
  // key: `${columnId}_${periodId}`
  const spannedCells = new Set<string>()

  // Pre-calculate spanned practicals
  for (const entry of dayEntries) {
    if (entry.column_id && entry.start_period_id !== entry.end_period_id) {
      const pStart = periodMap.get(entry.start_period_id)
      const pEnd = periodMap.get(entry.end_period_id)
      if (pStart && pEnd) {
        const startOrder = Math.min(pStart.period_order, pEnd.period_order)
        const endOrder = Math.max(pStart.period_order, pEnd.period_order)

        for (const p of periods) {
          if (p.period_order > startOrder && p.period_order <= endOrder) {
            spannedCells.add(`${entry.column_id}_${p.id}`)
          }
        }
      }
    }
  }

  // Conflict set for quick lookup
  const conflictPeriodColKeys = new Set<string>()
  validation?.errors.forEach(err => {
    if (err.weekday === currentWeekday) {
      err.periodIds.forEach(pId => {
        if (err.columnId) {
          conflictPeriodColKeys.add(`${err.columnId}_${pId}`)
        }
      })
    }
  })

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-xs">
      <table className="w-full border-collapse text-left min-w-[760px]">
        <thead>
          <tr className="bg-gray-50/80 border-b border-gray-200">
            {/* Period / Time Header */}
            <th className="p-3 text-xs font-bold uppercase tracking-wider text-gray-500 w-44 sticky left-0 bg-gray-50 z-10 border-r border-gray-200">
              Period / Time
            </th>

            {/* Branch / Class Headers */}
            {columns.map(col => (
              <th
                key={col.id}
                className="p-3 text-xs font-bold uppercase tracking-wider text-gray-700 border-r border-gray-200 last:border-r-0 min-w-[190px]"
              >
                {col.display_label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-200 text-sm">
          {periods.map(period => {
            // Check if this period has a full-width break entry
            const fullWidthBreak = dayEntries.find(
              e =>
                e.column_id === null &&
                e.entry_type === 'break' &&
                e.start_period_id <= period.id &&
                e.end_period_id >= period.id
            )

            if (fullWidthBreak || period.is_break) {
              const label =
                fullWidthBreak?.common_break_label || period.break_label || 'Break / Recess'
              return (
                <tr
                  key={`period-${period.id}`}
                  className="bg-amber-50/70 hover:bg-amber-100/70 transition-colors cursor-pointer"
                  onClick={() => onFullWidthBreakClick?.(period, fullWidthBreak)}
                >
                  <td className="p-2.5 text-xs font-bold text-amber-900 border-r border-amber-200 sticky left-0 bg-amber-50/90 z-10">
                    <div>{period.start_time} - {period.end_time}</div>
                    <div className="text-[10px] font-normal text-amber-700">Period {period.period_order}</div>
                  </td>
                  <td
                    colSpan={columns.length}
                    className="p-3 text-center text-xs font-bold text-amber-900 uppercase tracking-widest"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Coffee size={15} className="text-amber-600" />
                      <span>{label}</span>
                    </div>
                  </td>
                </tr>
              )
            }

            return (
              <tr key={`period-${period.id}`} className="hover:bg-gray-50/40 transition-colors">
                {/* Sticky Period/Time cell */}
                <td className="p-3 text-xs border-r border-gray-200 font-medium text-gray-700 sticky left-0 bg-white z-10">
                  <div className="font-bold text-gray-900">{period.start_time} - {period.end_time}</div>
                  <div className="text-[11px] text-gray-400">Period {period.period_order}</div>
                </td>

                {/* Branch Columns */}
                {columns.map(col => {
                  const cellKey = `${col.id}_${period.id}`

                  // Skip rendering if spanned by a previous multi-period row
                  if (spannedCells.has(cellKey)) {
                    return null
                  }

                  // Find entry starting at this period for this column
                  const entry = dayEntries.find(
                    e => e.column_id === col.id && e.start_period_id === period.id
                  )

                  // Compute rowSpan if multi-period
                  let rowSpan = 1
                  if (entry && entry.start_period_id !== entry.end_period_id) {
                    const pStart = periodMap.get(entry.start_period_id)
                    const pEnd = periodMap.get(entry.end_period_id)
                    if (pStart && pEnd) {
                      rowSpan = Math.abs(pEnd.period_order - pStart.period_order) + 1
                    }
                  }

                  const hasConflict = conflictPeriodColKeys.has(cellKey)

                  if (!entry) {
                    // Empty Cell
                    return (
                      <td
                        key={col.id}
                        rowSpan={1}
                        onClick={() => onCellClick(col, period)}
                        className="p-2 border-r border-gray-200 last:border-r-0 cursor-pointer group hover:bg-blue-50/30 transition-colors"
                      >
                        <div className="h-16 rounded-xl border border-dashed border-gray-200 flex items-center justify-center text-gray-300 group-hover:border-blue-400 group-hover:text-blue-500 transition-colors">
                          <Plus size={16} />
                        </div>
                      </td>
                    )
                  }

                  // Render Scheduled Entry
                  return (
                    <td
                      key={col.id}
                      rowSpan={rowSpan}
                      onClick={() => onCellClick(col, period, entry)}
                      className={`p-2 border-r border-gray-200 last:border-r-0 cursor-pointer align-top ${
                        hasConflict ? 'bg-rose-50/80 ring-2 ring-rose-400 inset-0' : ''
                      }`}
                    >
                      <div
                        className={`rounded-xl p-2.5 transition-all text-xs border ${
                          entry.entry_type === 'practical'
                            ? 'bg-indigo-50/70 border-indigo-200 text-indigo-950 hover:bg-indigo-100/70'
                            : entry.entry_type === 'tutorial'
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950 hover:bg-emerald-100/70'
                            : 'bg-blue-50/70 border-blue-200 text-blue-950 hover:bg-blue-100/70'
                        }`}
                      >
                        {/* Top bar of card */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="inline-flex items-center gap-1 font-semibold text-[10px] uppercase tracking-wider text-gray-500">
                            {entry.entry_type === 'practical' ? (
                              <>
                                <FlaskConical size={12} className="text-indigo-600" /> Lab ({rowSpan}h)
                              </>
                            ) : entry.entry_type === 'tutorial' ? (
                              <>
                                <GraduationCap size={12} className="text-emerald-600" /> Tutorial
                              </>
                            ) : (
                              <>
                                <BookOpen size={12} className="text-blue-600" /> Theory
                              </>
                            )}
                          </span>

                          {hasConflict && (
                            <span title="Conflict Detected" className="text-rose-600">
                              <AlertCircle size={14} />
                            </span>
                          )}
                        </div>

                        {/* Practical: Multi-batch view */}
                        {entry.entry_type === 'practical' ? (
                          <div className="space-y-1">
                            {entry.subentries.map((sub, sIdx) => {
                              const sSubject = subjectMap.get(sub.subject_id)
                              const sProf = profMap.get(sub.professor_id)
                              const sBatch = sub.batch_id ? batchMap.get(sub.batch_id) : null
                              const profAbbr = sProf?.abbreviation ? ` [${sProf.abbreviation}]` : ''

                              return (
                                <div
                                  key={sIdx}
                                  className="text-[11px] bg-white/90 rounded-lg p-1.5 border border-indigo-100 shadow-2xs leading-tight"
                                >
                                  <div className="font-bold text-indigo-900 truncate">
                                    {sBatch ? `${sBatch.name}: ` : ''}
                                    {sSubject?.code || sSubject?.name || 'Lab'}
                                  </div>
                                  <div className="text-[10px] text-gray-600 truncate mt-0.5">
                                    {sProf ? `${profAbbr}` : 'TBA'} {sub.room ? `· ${sub.room}` : ''}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          /* Theory or Tutorial Single View */
                          entry.subentries.map((sub, sIdx) => {
                            const sSubject = subjectMap.get(sub.subject_id)
                            const sProf = profMap.get(sub.professor_id)
                            const profAbbr = sProf?.abbreviation ? ` [${sProf.abbreviation}]` : ''
                            const profName = (sProf as any)?.profiles?.name || ''

                            return (
                              <div key={sIdx} className="space-y-0.5">
                                <div className="font-bold text-gray-900 text-xs truncate">
                                  {sSubject?.name || 'Subject'}
                                </div>
                                <div className="text-[11px] font-medium text-gray-700 truncate">
                                  {profAbbr || profName || 'Faculty'}
                                  {sub.room ? ` · ${sub.room}` : ''}
                                </div>
                                {sSubject?.code && (
                                  <div className="text-[10px] text-gray-400 font-mono">
                                    {sSubject.code}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
