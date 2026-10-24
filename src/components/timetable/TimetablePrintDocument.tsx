import type {
  MasterTimetable,
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
} from '../../types/timetableStudio'
import type { Subject, Professor, Batch } from '../../types'

interface Props {
  timetable: MasterTimetable
  periods: MasterTimetablePeriod[]
  columns: MasterTimetableColumn[]
  entries: MasterTimetableEntry[]
  selectedWeekday?: number // if undefined, renders all weekdays or specified weekday
  subjects: Subject[]
  professors: (Professor & { abbreviation?: string | null })[]
  batches: Batch[]
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function TimetablePrintDocument({
  timetable,
  periods,
  columns,
  entries,
  selectedWeekday,
  subjects,
  professors,
  batches,
}: Props) {
  const subjectMap = new Map<number, Subject>(subjects.map(s => [s.id, s]))
  const profMap = new Map<number, Professor & { abbreviation?: string | null }>(
    professors.map(p => [p.id, p])
  )
  const batchMap = new Map<number, Batch>(batches.map(b => [b.id, b]))
  const periodMap = new Map<number, MasterTimetablePeriod>(periods.map(p => [p.id, p]))

  // Which days to display
  const daysToRender = selectedWeekday !== undefined ? [selectedWeekday] : [0, 1, 2, 3, 4, 5]

  // Extract unique professors assigned in this timetable for the legend
  const assignedProfIds = new Set<number>()
  const assignedSubjectIds = new Set<number>()

  entries.forEach(e => {
    e.subentries.forEach(sub => {
      if (sub.professor_id) assignedProfIds.add(sub.professor_id)
      if (sub.subject_id) assignedSubjectIds.add(sub.subject_id)
    })
  })

  const legendProfessors = Array.from(assignedProfIds)
    .map(id => profMap.get(id))
    .filter(Boolean) as (Professor & { abbreviation?: string | null })[]

  const legendSubjects = Array.from(assignedSubjectIds)
    .map(id => subjectMap.get(id))
    .filter(Boolean) as Subject[]

  return (
    <div
      id="printable-timetable-document"
      className="bg-white p-8 text-black font-sans max-w-[1200px] mx-auto border border-gray-300 shadow-lg print:border-none print:shadow-none print:p-2"
    >
      {/* 1. Institutional Header */}
      <div className="text-center border-b-2 border-black pb-4 mb-4">
        <h1 className="text-xl font-black uppercase tracking-wider">
          {timetable.header_title || 'COLLEGE COMPANION ENGINEERING INSTITUTE'}
        </h1>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-800 mt-0.5">
          {timetable.header_subtitle || 'DEPARTMENT OF COMPUTER ENGINEERING & TECHNOLOGY'}
        </h2>
        <div className="mt-2 inline-block border border-black px-4 py-1 text-xs font-bold uppercase tracking-widest bg-gray-100">
          MASTER TIME TABLE — ACADEMIC YEAR {timetable.academic_year || '2026-27'}
        </div>
        <div className="flex items-center justify-between text-xs font-semibold mt-2 px-2 text-gray-700">
          <span>COHORT: {timetable.cohort || 'TE'} · SEMESTER: {timetable.semester}</span>
          <span>WITH EFFECT FROM (W.E.F.): {timetable.effective_date || 'TBA'}</span>
        </div>
      </div>

      {/* 2. Days Loop */}
      {daysToRender.map(dayIdx => {
        const dayEntries = entries.filter(e => e.weekday === dayIdx)
        const dayName = WEEKDAYS[dayIdx]

        // Spanned cells tracking
        const spannedCells = new Set<string>()
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

        return (
          <div key={`day-${dayIdx}`} className="mb-6 page-break-inside-avoid">
            {daysToRender.length > 1 && (
              <div className="bg-gray-800 text-white text-xs font-bold uppercase py-1 px-3 tracking-wider mb-1">
                {dayName}
              </div>
            )}

            <table className="w-full border-collapse border-2 border-black text-xs">
              <thead>
                <tr className="bg-gray-100 border-b-2 border-black text-center font-bold">
                  <th className="border border-black p-2 w-32">TIME / PERIOD</th>
                  {columns.map(col => (
                    <th key={col.id} className="border border-black p-2">
                      {col.display_label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map(period => {
                  // Full width break
                  const fullBreak = dayEntries.find(
                    e =>
                      e.column_id === null &&
                      e.entry_type === 'break' &&
                      e.start_period_id <= period.id &&
                      e.end_period_id >= period.id
                  )

                  if (fullBreak || period.is_break) {
                    const label = fullBreak?.common_break_label || period.break_label || 'RECESS'
                    return (
                      <tr key={period.id} className="bg-gray-100 font-bold text-center border border-black">
                        <td className="border border-black p-1 text-[11px]">
                          {period.start_time} - {period.end_time}
                        </td>
                        <td
                          colSpan={columns.length}
                          className="border border-black p-1 text-[11px] tracking-widest uppercase bg-gray-200"
                        >
                          * * * {label} * * *
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr key={period.id} className="border border-black">
                      <td className="border border-black p-1.5 text-center font-semibold text-[11px] bg-gray-50">
                        <div>{period.start_time} - {period.end_time}</div>
                        <div className="text-[10px] text-gray-500 font-normal">Period {period.period_order}</div>
                      </td>

                      {columns.map(col => {
                        const cellKey = `${col.id}_${period.id}`
                        if (spannedCells.has(cellKey)) return null

                        const entry = dayEntries.find(
                          e => e.column_id === col.id && e.start_period_id === period.id
                        )

                        let rowSpan = 1
                        if (entry && entry.start_period_id !== entry.end_period_id) {
                          const pStart = periodMap.get(entry.start_period_id)
                          const pEnd = periodMap.get(entry.end_period_id)
                          if (pStart && pEnd) {
                            rowSpan = Math.abs(pEnd.period_order - pStart.period_order) + 1
                          }
                        }

                        if (!entry) {
                          return (
                            <td
                              key={col.id}
                              rowSpan={1}
                              className="border border-black p-2 text-center text-gray-300 italic"
                            >
                              —
                            </td>
                          )
                        }

                        return (
                          <td
                            key={col.id}
                            rowSpan={rowSpan}
                            className="border border-black p-2 align-middle text-center bg-white"
                          >
                            {entry.entry_type === 'practical' ? (
                              <div className="space-y-1 text-left text-[11px]">
                                <div className="font-bold text-[10px] text-gray-600 uppercase border-b border-gray-200 pb-0.5 mb-1">
                                  PRACTICAL LAB BLOCK ({rowSpan} Hrs)
                                </div>
                                {entry.subentries.map((sub, sIdx) => {
                                  const sSubject = subjectMap.get(sub.subject_id)
                                  const sProf = profMap.get(sub.professor_id)
                                  const sBatch = sub.batch_id ? batchMap.get(sub.batch_id) : null
                                  const abbr = sProf?.abbreviation ? `[${sProf.abbreviation}]` : ''

                                  return (
                                    <div key={sIdx} className="leading-tight">
                                      <span className="font-bold">{sBatch?.name || 'Lab'}: </span>
                                      <span>{sSubject?.code || sSubject?.name} </span>
                                      <span className="font-semibold">{abbr} </span>
                                      {sub.room && <span className="text-gray-600">({sub.room})</span>}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              entry.subentries.map((sub, sIdx) => {
                                const sSubject = subjectMap.get(sub.subject_id)
                                const sProf = profMap.get(sub.professor_id)
                                const abbr = sProf?.abbreviation ? `[${sProf.abbreviation}]` : ''

                                return (
                                  <div key={sIdx} className="leading-tight">
                                    <div className="font-bold text-xs">
                                      {sSubject?.name || 'Subject'}
                                    </div>
                                    <div className="text-[11px] text-gray-800 mt-0.5">
                                      {abbr ? <span className="font-bold">{abbr} </span> : null}
                                      {sub.room ? <span>({sub.room})</span> : null}
                                    </div>
                                  </div>
                                )
                              })
                            )}
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
      })}

      {/* 3. Legends: Faculty Abbreviations & Subjects */}
      <div className="grid grid-cols-2 gap-4 border-t-2 border-black pt-4 text-xs">
        {/* Faculty Legend */}
        <div>
          <h4 className="font-bold uppercase tracking-wider mb-1 text-[11px] border-b border-black pb-0.5">
            Faculty Legend
          </h4>
          <table className="w-full border border-gray-300 text-[11px]">
            <thead>
              <tr className="bg-gray-100 text-left font-bold border-b border-gray-300">
                <th className="p-1 border-r border-gray-300 w-16">CODE</th>
                <th className="p-1 border-r border-gray-300">FACULTY NAME</th>
                <th className="p-1">DEPARTMENT</th>
              </tr>
            </thead>
            <tbody>
              {legendProfessors.map(prof => (
                <tr key={prof.id} className="border-b border-gray-200">
                  <td className="p-1 font-mono font-bold border-r border-gray-300">
                    [{prof.abbreviation || '??'}]
                  </td>
                  <td className="p-1 border-r border-gray-300">
                    {(prof as any)?.profiles?.name || `Faculty #${prof.id}`}
                  </td>
                  <td className="p-1 text-gray-600">
                    {(prof as any)?.departments?.name || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Subjects Legend */}
        <div>
          <h4 className="font-bold uppercase tracking-wider mb-1 text-[11px] border-b border-black pb-0.5">
            Subject Legend
          </h4>
          <table className="w-full border border-gray-300 text-[11px]">
            <thead>
              <tr className="bg-gray-100 text-left font-bold border-b border-gray-300">
                <th className="p-1 border-r border-gray-300 w-20">CODE</th>
                <th className="p-1 border-r border-gray-300">SUBJECT TITLE</th>
                <th className="p-1 w-16">TYPE</th>
              </tr>
            </thead>
            <tbody>
              {legendSubjects.map(sub => (
                <tr key={sub.id} className="border-b border-gray-200">
                  <td className="p-1 font-mono font-bold border-r border-gray-300">
                    {sub.code}
                  </td>
                  <td className="p-1 border-r border-gray-300 truncate">
                    {sub.name}
                  </td>
                  <td className="p-1 text-gray-600 capitalize">
                    {sub.type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Footer Notes & Signatures */}
      <div className="mt-8 pt-4 border-t border-gray-300 flex items-end justify-between text-center text-xs">
        <div>
          <div className="font-bold text-gray-800">Timetable Coordinator</div>
          <div className="text-[10px] text-gray-500 mt-6">Signature & Date</div>
        </div>

        <div>
          <div className="font-bold text-gray-800">Academic Dean</div>
          <div className="text-[10px] text-gray-500 mt-6">Signature & Date</div>
        </div>

        <div>
          <div className="font-bold text-gray-800">Head of Department (HOD)</div>
          <div className="text-[10px] text-gray-500 mt-6">Signature & Date</div>
        </div>

        <div>
          <div className="font-bold text-gray-800">Principal</div>
          <div className="text-[10px] text-gray-500 mt-6">Seal & Approval</div>
        </div>
      </div>
    </div>
  )
}
