import type { MasterTimetableGridData } from '../../types/timetableMaker.ts'

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
    <div className="bg-white p-4 md:p-6 text-black font-sans max-w-[1100px] mx-auto border-2 border-black shadow-lg overflow-x-auto select-none">
      {/* ─── 1. INSTITUTIONAL HEADER BOX ───────────────────────── */}
      <div className="border border-black flex items-stretch">
        {/* Left: Logo */}
        <div className="w-36 md:w-44 border-r border-black p-2 flex items-center justify-center flex-shrink-0 bg-white">
          <img
            src="/mes_logo.png"
            alt="MES Logo"
            className="max-h-28 max-w-full object-contain"
            onError={e => {
              // Graceful fallback
              (e.currentTarget as HTMLElement).style.display = 'none'
            }}
          />
        </div>

        {/* Right: Institutional Text */}
        <div className="flex-1 p-3 text-center flex flex-col justify-center">
          <h2 className="text-sm md:text-base font-bold font-serif tracking-wide uppercase text-gray-900">
            MAHARASHTRA EDUCATION SOCIETY'S
          </h2>
          <h1 className="text-base md:text-xl font-bold font-serif uppercase text-gray-950 mt-0.5">
            MUKUNDDAS LOHIA COLLEGE OF ENGINEERING, PUNE
          </h1>
          <p className="text-[11px] md:text-xs font-serif text-gray-800 mt-1 leading-snug">
            (Approved by AICTE, Recognized by Govt. of Maharashtra and Affiliated to Dr. Babasaheb Ambedkar Technological University (DBATU), Lonere)
          </p>
        </div>
      </div>

      {/* ─── 2. "Master Time Table" BAR ─────────────────────────── */}
      <div className="bg-[#D9D9D9] border-x border-b border-black py-1.5 text-center font-serif font-bold text-sm md:text-base tracking-wide text-black">
        Master Time Table
      </div>

      {/* ─── 3. METADATA LINES ──────────────────────────────────── */}
      <div className="border-x border-b border-black p-2 space-y-1 bg-white">
        <div className="flex justify-between items-center text-sm md:text-base font-serif font-bold">
          <span>A. Y.: {grid.academicYear || '2026-27'}</span>
          <span>SEM: {grid.semester || 'I'}</span>
        </div>
        <div className="flex justify-between items-center text-sm md:text-base font-serif font-bold">
          <span className="text-base md:text-lg">Class: {grid.className || 'FY BTECH'}</span>
          <span className="text-base md:text-lg text-[#D00000]">Date: {grid.date || '22/10/2026'}</span>
        </div>
      </div>

      {/* ─── 4. MAIN TIMETABLE GRID ─────────────────────────────── */}
      <table className="w-full border-collapse border-x border-b border-black text-xs md:text-sm">
        <thead>
          <tr className="bg-[#C7DDB5] border-b border-black font-bold text-center">
            <th className="border border-black py-2 px-1 w-32 md:w-36">Time</th>
            {grid.branches.map((branch, idx) => (
              <th key={idx} className="border border-black py-2 px-1">
                {branch}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.periods.map(period => {
            // Full width break row
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

                  let bgClass = 'bg-white'
                  if (cell?.type === 'practical') bgClass = 'bg-[#FAD2D2]' // soft peach/pink
                  else if (cell?.type === 'empty') bgClass = 'bg-[#EDE9F6]' // subtle light purple

                  return (
                    <td
                      key={bIdx}
                      rowSpan={rowSpan}
                      onClick={() => interactive && onCellClick?.(period.id, bIdx)}
                      className={`border border-black p-2 text-center align-middle ${bgClass} ${
                        interactive ? 'cursor-pointer hover:ring-2 hover:ring-blue-500 hover:ring-inset' : ''
                      }`}
                      title={interactive ? `Click to edit ${grid.branches[bIdx]} at ${period.startTime}` : undefined}
                    >
                      {!cell || cell.type === 'empty' ? (
                        <span className="font-bold text-gray-500">-</span>
                      ) : cell.type === 'practical' ? (
                        cell.batch1 && cell.batch2 ? (
                          <div className="text-left font-bold text-[11px] md:text-xs leading-snug">
                            <div>1.{cell.batch1.subject} [{cell.batch1.profAbbr}] [{cell.batch1.room}]</div>
                            <div>2. {cell.batch2.subject} [{cell.batch2.profAbbr}] [{cell.batch2.room}]</div>
                          </div>
                        ) : (
                          <div className="font-bold text-xs md:text-sm leading-snug">
                            {cell.text ? (
                              cell.text.split('\n').map((line, lIdx) => <div key={lIdx}>{line}</div>)
                            ) : (
                              <>
                                <div>{cell.subject} [{cell.professorAbbr}] Practical</div>
                                <div>[{cell.room}]</div>
                              </>
                            )}
                          </div>
                        )
                      ) : (
                        <div className="font-bold text-xs md:text-sm leading-snug">
                          {cell.subject ? `${cell.subject} [${cell.professorAbbr || ''}] [${cell.room || ''}]` : (cell.text || '-')}
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
        <table className="w-full border-collapse text-xs md:text-sm">
          <thead>
            <tr className="bg-[#DCD6EB] border-b border-black font-bold text-center">
              <th className="border-r border-black p-1.5 w-40 md:w-48">Branch</th>
              {grid.branches.map((b, idx) => (
                <th key={idx} className="border-r border-black p-1.5 last:border-r-0">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="text-center font-bold">
              <td className="border-r border-black p-1.5 bg-white">FE Class Coordinators</td>
              {grid.coordinators.map((coord, idx) => (
                <td key={idx} className="border-r border-black p-1.5 last:border-r-0 bg-white">
                  {coord.name}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ─── 6. PRACTICAL SESSION NOTE BOX ──────────────────────── */}
      <div className="mt-3 border-2 border-black flex flex-col md:flex-row items-stretch">
        {/* Left note label */}
        <div className="p-3 border-b md:border-b-0 md:border-r border-black flex items-center bg-white font-serif font-bold text-sm md:text-base md:w-96 flex-shrink-0">
          Note: For Practical Session:
        </div>

        {/* Right sub-table */}
        <div className="flex-1 bg-[#CFE2F3]">
          <table className="w-full border-collapse text-xs md:text-sm">
            <tbody>
              <tr className="border-b border-black">
                <td className="border-r border-black p-1.5 font-bold w-28 md:w-36 text-center">Batch 1:</td>
                <td className="p-1.5 pl-3">{grid.practicalNotes?.batch1Roll || 'Roll No. 1 to 33.'}</td>
              </tr>
              <tr>
                <td className="border-r border-black p-1.5 font-bold w-28 md:w-36 text-center">Batch 2:</td>
                <td className="p-1.5 pl-3">{grid.practicalNotes?.batch2Roll || 'Roll no. 34 & Onwords.'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
