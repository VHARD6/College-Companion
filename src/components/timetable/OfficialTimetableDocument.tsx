import type { MasterTimetableGridData } from '../../types/timetableMaker.ts'
import { formatCellContent, OFFICIAL_TIMETABLE_GEOMETRY } from '../../lib/timetableCellFormatter.ts'

interface Props {
  grid: MasterTimetableGridData
  onCellClick?: (periodId: number, branchIdx: number) => void
  interactive?: boolean
}

export default function OfficialTimetableDocument({
  grid,
  onCellClick,
  interactive = false,
}: Props) {
  const coveredCells = new Set<string>()

  return (
    <div className="bg-white p-3 md:p-6 text-black font-sans max-w-[1100px] mx-auto border-2 border-black shadow-lg overflow-x-auto select-none">
      {/* ─── 1. INSTITUTIONAL HEADER BOX ───────────────────────── */}
      <div className="border border-black flex items-stretch">
        {/* Left: Logo (exact width matching Time column: 19.333%) */}
        <div
          style={{ width: OFFICIAL_TIMETABLE_GEOMETRY.timeColPercent }}
          className="border-r border-black p-2 flex items-center justify-center shrink-0 bg-white"
        >
          <img
            src="/mes_logo.png"
            alt="MES Logo"
            className="max-h-28 max-w-full object-contain"
            onError={e => {
              (e.currentTarget as HTMLElement).style.display = 'none'
            }}
          />
        </div>

        {/* Right: Institutional Text */}
        <div className="flex-1 p-2 md:p-3 text-center flex flex-col justify-center bg-white">
          <h2 className="text-xs md:text-sm font-bold font-serif tracking-wide uppercase text-gray-900 leading-snug">
            MAHARASHTRA EDUCATION SOCIETY'S
          </h2>
          <h1 className="text-sm md:text-lg font-bold font-serif uppercase text-gray-950 mt-0.5 leading-tight">
            MUKUNDDAS LOHIA COLLEGE OF ENGINEERING,
          </h1>
          <h1 className="text-sm md:text-lg font-bold font-serif uppercase text-gray-950 mt-0.5 leading-tight">
            PUNE
          </h1>
          <p className="text-[10px] md:text-xs font-serif text-gray-800 mt-1 leading-snug">
            (Approved by AICTE, Recognized by Govt. of Maharashtra and Affiliated to Dr. Babasaheb Ambedkar Technological University (DBATU), Lonere)
          </p>
        </div>
      </div>

      {/* ─── 2. "Master Time Table" BAR ─────────────────────────── */}
      <div className="bg-[#D9D9D9] border-x border-b border-black py-1.5 text-center font-serif font-bold text-sm md:text-base tracking-wide text-black">
        Master Time Table
      </div>

      {/* ─── 3. METADATA LINES ──────────────────────────────────── */}
      <div className="border-x border-b border-black px-3 py-1.5 space-y-1 bg-white font-serif font-bold">
        <div className="flex justify-between items-center text-xs md:text-base">
          <span>A. Y.: {grid.academicYear || '2026-27'}</span>
          <span>SEM: {grid.semester || 'I'}</span>
        </div>
        <div className="flex justify-between items-center text-sm md:text-lg">
          <span>Class: {grid.className || 'FY BTECH'}</span>
          <span className="text-[#D00000]">Date: {grid.date || '22/10/2026'}</span>
        </div>
      </div>

      {/* ─── 4. MAIN TIMETABLE GRID ─────────────────────────────── */}
      <table className="w-full table-fixed border-collapse border-x border-b border-black text-xs md:text-sm">
        <colgroup>
          <col style={{ width: OFFICIAL_TIMETABLE_GEOMETRY.timeColPercent }} />
          {grid.branches.map((_, idx) => (
            <col key={idx} style={{ width: OFFICIAL_TIMETABLE_GEOMETRY.branchColPercent }} />
          ))}
        </colgroup>

        <thead>
          <tr className="bg-[#C7DDB5] border-b border-black font-bold text-center">
            <th className="border border-black py-2 px-1 text-center font-bold">Time</th>
            {grid.branches.map((branch, idx) => (
              <th key={idx} className="border border-black py-2 px-1 text-center font-bold">
                {branch}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {grid.periods.map(period => {
            // Full width break row (e.g. Short Break or Long Break)
            if (period.isBreak) {
              return (
                <tr key={period.id} className="border-b border-black">
                  <td className="border border-black py-2 px-1 text-center font-bold bg-white whitespace-nowrap">
                    {period.startTime} - {period.endTime}
                  </td>
                  <td
                    colSpan={grid.branches.length}
                    className="border border-black py-2 px-2 text-center font-serif font-bold bg-[#DCD6EB] text-black tracking-wide"
                  >
                    {period.breakLabel || 'Break'}
                  </td>
                </tr>
              )
            }

            return (
              <tr key={period.id} className="border-b border-black">
                <td className="border border-black py-2 px-1 text-center font-bold bg-white whitespace-nowrap">
                  {period.startTime} - {period.endTime}
                </td>

                {grid.branches.map((_b, bIdx) => {
                  const cellKey = `${period.id}_${bIdx}`
                  if (coveredCells.has(cellKey)) return null

                  const cell = grid.cells[cellKey]
                  const rowSpan = cell?.rowSpan || 1

                  if (rowSpan > 1) {
                    for (let s = 1; s < rowSpan; s++) {
                      coveredCells.add(`${period.id + s}_${bIdx}`)
                    }
                  }

                  const formatted = formatCellContent(cell)

                  return (
                    <td
                      key={bIdx}
                      rowSpan={rowSpan}
                      onClick={() => interactive && onCellClick?.(period.id, bIdx)}
                      style={{ backgroundColor: formatted.bgColor }}
                      className={`border border-black p-1 md:p-2 text-center align-middle ${
                        interactive
                          ? 'cursor-pointer hover:ring-2 hover:ring-blue-500 hover:ring-inset'
                          : ''
                      }`}
                      title={
                        interactive
                          ? `Click to edit ${grid.branches[bIdx]} at ${period.startTime}`
                          : undefined
                      }
                    >
                      {formatted.isDash ? (
                        <span className="font-bold text-gray-900 text-sm md:text-base">-</span>
                      ) : formatted.isBatchSplit ? (
                        <div className="text-left font-bold text-[10px] md:text-xs leading-snug px-0.5">
                          {formatted.lines.map((line, lIdx) => (
                            <div key={lIdx} className="truncate">
                              {line}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="font-bold text-xs md:text-sm leading-snug text-center px-0.5">
                          {formatted.lines.map((line, lIdx) => (
                            <div key={lIdx} className="truncate">
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ─── 5. CLASS COORDINATORS TABLE ────────────────────────── */}
      <div className="mt-4 border-2 border-black">
        <table className="w-full table-fixed border-collapse text-xs md:text-sm">
          <colgroup>
            <col style={{ width: OFFICIAL_TIMETABLE_GEOMETRY.timeColPercent }} />
            {grid.branches.map((_, idx) => (
              <col key={idx} style={{ width: OFFICIAL_TIMETABLE_GEOMETRY.branchColPercent }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-[#DCD6EB] border-b border-black font-bold text-center">
              <th className="border-r border-black p-1.5 text-center font-bold">Branch</th>
              {grid.branches.map((b, idx) => (
                <th key={idx} className="border-r border-black p-1.5 last:border-r-0 text-center font-bold">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="text-center font-bold">
              <td className="border-r border-black p-1.5 bg-white text-center font-bold">
                FE Class Coordinators
              </td>
              {grid.coordinators.map((coord, idx) => (
                <td
                  key={idx}
                  className="border-r border-black p-1.5 last:border-r-0 bg-white text-center font-bold truncate px-1"
                >
                  {coord.name}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ─── 6. PRACTICAL SESSION NOTE BOX ──────────────────────── */}
      <div className="mt-3 border-2 border-black flex flex-row items-stretch">
        {/* Left note label (proportional width matching reference: 47.33%) */}
        <div
          style={{ width: `${OFFICIAL_TIMETABLE_GEOMETRY.noteLeftRatio * 100}%` }}
          className="p-2 md:p-3 border-r border-black flex items-center bg-white font-serif font-bold text-xs md:text-base shrink-0"
        >
          Note: For Practical Session:
        </div>

        {/* Right sub-table */}
        <div className="flex-1 bg-[#CFE2F3]">
          <table className="w-full table-fixed border-collapse text-xs md:text-sm">
            <colgroup>
              <col style={{ width: `${OFFICIAL_TIMETABLE_GEOMETRY.noteBatchLabelRatio * 100}%` }} />
              <col style={{ width: `${(1 - OFFICIAL_TIMETABLE_GEOMETRY.noteBatchLabelRatio) * 100}%` }} />
            </colgroup>
            <tbody>
              <tr className="border-b border-black">
                <td className="border-r border-black p-1.5 font-bold text-center">Batch 1:</td>
                <td className="p-1.5 pl-3 font-medium">
                  {grid.practicalNotes?.batch1Roll || 'Roll No. 1 to 33.'}
                </td>
              </tr>
              <tr>
                <td className="border-r border-black p-1.5 font-bold text-center">Batch 2:</td>
                <td className="p-1.5 pl-3 font-medium">
                  {grid.practicalNotes?.batch2Roll || 'Roll no. 34 & Onwords.'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
