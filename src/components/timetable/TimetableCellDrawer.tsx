import { useState, useEffect } from 'react'
import type {
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
  MasterTimetableSubentry,
  TimetableEntryType,
} from '../../types/timetableStudio'
import type { Subject, Professor, Batch } from '../../types'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Select from '../ui/Select'
import { X, Trash2, Plus, FlaskConical, BookOpen, Coffee, GraduationCap } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (entry: MasterTimetableEntry) => void
  onDelete?: (entryId: number | undefined) => void
  periods: MasterTimetablePeriod[]
  column: MasterTimetableColumn | null
  currentWeekday: number
  existingEntry?: MasterTimetableEntry | null
  defaultStartPeriodId?: number
  subjects: Subject[]
  professors: (Professor & { abbreviation?: string | null })[]
  batches: Batch[]
}

export default function TimetableCellDrawer({
  isOpen,
  onClose,
  onSave,
  onDelete,
  periods,
  column,
  currentWeekday,
  existingEntry,
  defaultStartPeriodId,
  subjects,
  professors,
  batches,
}: Props) {
  const [entryType, setEntryType] = useState<TimetableEntryType>('lecture')
  const [startPeriodId, setStartPeriodId] = useState<number>(defaultStartPeriodId || periods[0]?.id || 1)
  const [endPeriodId, setEndPeriodId] = useState<number>(defaultStartPeriodId || periods[0]?.id || 1)
  const [breakLabel, setBreakLabel] = useState('Recess')
  const [isFullWidthBreak, setIsFullWidthBreak] = useState(true)

  // Single lecture fields
  const [subjectId, setSubjectId] = useState<number | ''>('')
  const [professorId, setProfessorId] = useState<number | ''>('')
  const [room, setRoom] = useState('')

  // Practical batch rows
  interface BatchRow {
    batchId: number | ''
    subjectId: number | ''
    professorId: number | ''
    room: string
  }
  const [batchRows, setBatchRows] = useState<BatchRow[]>([])

  useEffect(() => {
    if (existingEntry) {
      setEntryType(existingEntry.entry_type)
      setStartPeriodId(existingEntry.start_period_id)
      setEndPeriodId(existingEntry.end_period_id)
      setBreakLabel(existingEntry.common_break_label || 'Recess')
      setIsFullWidthBreak(existingEntry.column_id === null)

      if (existingEntry.entry_type === 'lecture' || existingEntry.entry_type === 'tutorial') {
        const sub = existingEntry.subentries[0]
        setSubjectId(sub?.subject_id || '')
        setProfessorId(sub?.professor_id || '')
        setRoom(sub?.room || '')
      } else if (existingEntry.entry_type === 'practical') {
        setBatchRows(
          existingEntry.subentries.map(s => ({
            batchId: s.batch_id || '',
            subjectId: s.subject_id || '',
            professorId: s.professor_id || '',
            room: s.room || '',
          }))
        )
      }
    } else {
      // New slot
      const initialPeriod = defaultStartPeriodId || periods[0]?.id || 1
      setEntryType('lecture')
      setStartPeriodId(initialPeriod)
      setEndPeriodId(initialPeriod)
      setSubjectId('')
      setProfessorId('')
      setRoom('')
      setBreakLabel('Recess')
      setIsFullWidthBreak(false)

      // Pre-fill practical batches if class has batches
      if (batches.length > 0) {
        setBatchRows(
          batches.map(b => ({
            batchId: b.id,
            subjectId: '',
            professorId: '',
            room: '',
          }))
        )
      } else {
        setBatchRows([])
      }
    }
  }, [existingEntry, defaultStartPeriodId, periods, batches, isOpen])

  if (!isOpen) return null

  const handleSave = () => {
    if (entryType === 'break') {
      const entry: MasterTimetableEntry = {
        id: existingEntry?.id,
        timetable_id: periods[0]?.timetable_id || 1,
        weekday: currentWeekday,
        start_period_id: startPeriodId,
        end_period_id: endPeriodId,
        column_id: isFullWidthBreak ? null : column?.id || null,
        entry_type: 'break',
        common_break_label: breakLabel.trim() || 'Break',
        subentries: [],
      }
      onSave(entry)
      onClose()
      return
    }

    if (entryType === 'lecture' || entryType === 'tutorial') {
      if (!subjectId || !professorId) {
        alert('Please select both a subject and a professor.')
        return
      }

      const subentry: MasterTimetableSubentry = {
        subject_id: Number(subjectId),
        professor_id: Number(professorId),
        batch_id: null,
        room: room.trim() || null,
      }

      const entry: MasterTimetableEntry = {
        id: existingEntry?.id,
        timetable_id: periods[0]?.timetable_id || 1,
        weekday: currentWeekday,
        start_period_id: startPeriodId,
        end_period_id: endPeriodId,
        column_id: column?.id || null,
        entry_type: entryType,
        subentries: [subentry],
      }
      onSave(entry)
      onClose()
      return
    }

    if (entryType === 'practical') {
      const validSubentries: MasterTimetableSubentry[] = batchRows
        .filter(r => r.subjectId && r.professorId)
        .map(r => ({
          subject_id: Number(r.subjectId),
          professor_id: Number(r.professorId),
          batch_id: r.batchId ? Number(r.batchId) : null,
          room: r.room.trim() || null,
        }))

      if (validSubentries.length === 0) {
        alert('Please configure at least one practical batch with subject and professor.')
        return
      }

      const entry: MasterTimetableEntry = {
        id: existingEntry?.id,
        timetable_id: periods[0]?.timetable_id || 1,
        weekday: currentWeekday,
        start_period_id: startPeriodId,
        end_period_id: endPeriodId,
        column_id: column?.id || null,
        entry_type: 'practical',
        subentries: validSubentries,
      }
      onSave(entry)
      onClose()
    }
  }

  const periodOptions = periods.map(p => ({
    value: p.id,
    label: `Period ${p.period_order} (${p.start_time} - ${p.end_time})${p.is_break ? ` [${p.break_label}]` : ''}`,
  }))

  const subjectOptions = subjects.map(s => ({
    value: s.id,
    label: `${s.name} (${s.code}) - ${s.type}`,
  }))

  const professorOptions = professors.map(p => {
    const pName = (p as any)?.profiles?.name || `Faculty #${p.id}`
    const pAbbr = p.abbreviation ? ` [${p.abbreviation}]` : ' [NO ABBR]'
    return {
      value: p.id,
      label: `${pName}${pAbbr}`,
    }
  })

  const batchOptions = [
    { value: '', label: 'All Batches / Whole Class' },
    ...batches.map(b => ({ value: b.id, label: b.name })),
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col justify-between overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-gray-900 text-base">
              {existingEntry ? 'Edit Timetable Slot' : 'Schedule Timetable Slot'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {column?.display_label || 'Master Grid'} · {getWeekdayName(currentWeekday)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 space-y-4 flex-1">
          {/* Slot Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Session Type
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  setEntryType('lecture')
                  setEndPeriodId(startPeriodId)
                }}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  entryType === 'lecture'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <BookOpen size={18} className="mb-1" />
                Theory
              </button>

              <button
                type="button"
                onClick={() => {
                  setEntryType('practical')
                  // Set default 2-period practical if next period exists
                  const currentIdx = periods.findIndex(p => p.id === startPeriodId)
                  if (currentIdx !== -1 && currentIdx + 1 < periods.length) {
                    setEndPeriodId(periods[currentIdx + 1].id)
                  }
                }}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  entryType === 'practical'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-xs'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <FlaskConical size={18} className="mb-1" />
                Practical
              </button>

              <button
                type="button"
                onClick={() => {
                  setEntryType('tutorial')
                  setEndPeriodId(startPeriodId)
                }}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  entryType === 'tutorial'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-xs'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <GraduationCap size={18} className="mb-1" />
                Tutorial
              </button>

              <button
                type="button"
                onClick={() => {
                  setEntryType('break')
                  setEndPeriodId(startPeriodId)
                }}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  entryType === 'break'
                    ? 'border-amber-600 bg-amber-50 text-amber-700 shadow-xs'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Coffee size={18} className="mb-1" />
                Break
              </button>
            </div>
          </div>

          {/* Period Range */}
          <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
            <Select
              label="Start Period"
              value={startPeriodId}
              onChange={e => {
                const sId = Number(e.target.value)
                setStartPeriodId(sId)
                if (entryType === 'lecture' || entryType === 'break') {
                  setEndPeriodId(sId)
                }
              }}
              options={periodOptions}
            />

            <Select
              label="End Period"
              value={endPeriodId}
              onChange={e => setEndPeriodId(Number(e.target.value))}
              options={periodOptions}
              disabled={entryType === 'lecture'}
            />
          </div>

          {/* Form Fields: Break */}
          {entryType === 'break' && (
            <div className="space-y-3">
              <Input
                label="Break Label"
                value={breakLabel}
                onChange={e => setBreakLabel(e.target.value)}
                placeholder="e.g. Lunch Break, Recess, Tea Break"
              />

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={isFullWidthBreak}
                  onChange={e => setIsFullWidthBreak(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="font-medium">Full-Width Break (Spans all branch columns)</span>
              </label>
            </div>
          )}

          {/* Form Fields: Theory or Tutorial */}
          {(entryType === 'lecture' || entryType === 'tutorial') && (
            <div className="space-y-3">
              <Select
                label="Subject"
                value={subjectId}
                onChange={e => setSubjectId(Number(e.target.value))}
                options={subjectOptions}
                placeholder="Select Subject..."
              />

              <Select
                label="Professor (with abbreviation)"
                value={professorId}
                onChange={e => setProfessorId(Number(e.target.value))}
                options={professorOptions}
                placeholder="Select Faculty..."
              />

              <Input
                label="Room / Hall Number"
                value={room}
                onChange={e => setRoom(e.target.value)}
                placeholder="e.g. R401, LH-2"
              />
            </div>
          )}

          {/* Form Fields: Practical Multi-Batch */}
          {entryType === 'practical' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase text-gray-700 tracking-wider">
                    Batch-Wise Practical Allocations
                  </h4>
                  <p className="text-[11px] text-gray-500">
                    Define lab subjects, faculty, and labs running concurrently.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setBatchRows(prev => [
                      ...prev,
                      { batchId: '', subjectId: '', professorId: '', room: '' },
                    ])
                  }}
                >
                  <Plus size={14} className="mr-1" /> Add Batch
                </Button>
              </div>

              <div className="space-y-3">
                {batchRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2 relative"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-800">
                        Allocation #{idx + 1}
                      </span>
                      {batchRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setBatchRows(prev => prev.filter((_, i) => i !== idx))
                          }}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remove Batch"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        label="Batch"
                        value={row.batchId}
                        onChange={e => {
                          const val = e.target.value ? Number(e.target.value) : ''
                          setBatchRows(prev => {
                            const updated = [...prev]
                            updated[idx].batchId = val
                            return updated
                          })
                        }}
                        options={batchOptions}
                      />

                      <Input
                        label="Lab Room"
                        value={row.room}
                        onChange={e => {
                          const val = e.target.value
                          setBatchRows(prev => {
                            const updated = [...prev]
                            updated[idx].room = val
                            return updated
                          })
                        }}
                        placeholder="e.g. Lab 2"
                      />
                    </div>

                    <Select
                      label="Lab Subject"
                      value={row.subjectId}
                      onChange={e => {
                        const val = Number(e.target.value)
                        setBatchRows(prev => {
                          const updated = [...prev]
                          updated[idx].subjectId = val
                          return updated
                        })
                      }}
                      options={subjectOptions}
                      placeholder="Select Subject..."
                    />

                    <Select
                      label="Faculty"
                      value={row.professorId}
                      onChange={e => {
                        const val = Number(e.target.value)
                        setBatchRows(prev => {
                          const updated = [...prev]
                          updated[idx].professorId = val
                          return updated
                        })
                      }}
                      options={professorOptions}
                      placeholder="Select Faculty..."
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-100 flex items-center gap-3 bg-gray-50 sticky bottom-0">
          {existingEntry && onDelete && (
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                if (window.confirm('Are you sure you want to delete this scheduled slot?')) {
                  onDelete(existingEntry.id)
                  onClose()
                }
              }}
            >
              <Trash2 size={16} />
            </Button>
          )}

          <Button variant="ghost" size="md" className="flex-1" onClick={onClose}>
            Cancel
          </Button>

          <Button variant="primary" size="md" className="flex-1" onClick={handleSave}>
            {existingEntry ? 'Update Slot' : 'Save Slot'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function getWeekdayName(weekday: number): string {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  return days[weekday] || 'Day'
}
