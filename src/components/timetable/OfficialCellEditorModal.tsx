import { useState, useEffect } from 'react'
import type { TimetableCellData, TimetablePracticalBatch } from '../../types/timetableMaker.ts'
import type { Subject, Professor } from '../../types'
import Button from '../ui/Button'
import Select from '../ui/Select'
import Input from '../ui/Input'
import { X, Check } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  branch: string
  periodLabel: string
  initialData?: TimetableCellData
  subjects: Subject[]
  professors: (Professor & { abbreviation?: string | null })[]
  onSave: (data: TimetableCellData) => void
}

const COMMON_ROOMS = ['701', '702', '703', '403', '601', '602', '603', 'Workshop', 'EM LAB']

export default function OfficialCellEditorModal({
  isOpen,
  onClose,
  branch,
  periodLabel,
  initialData,
  subjects,
  professors,
  onSave,
}: Props) {
  const [mode, setMode] = useState<'theory' | 'practical_single' | 'practical_batch' | 'empty'>('theory')
  const [practicalSpan, setPracticalSpan] = useState<number>(2)

  // Theory or single practical fields
  const [subject, setSubject] = useState('')
  const [professorAbbr, setProfessorAbbr] = useState('')
  const [room, setRoom] = useState('')

  // Batch split fields
  const [b1Subject, setB1Subject] = useState('')
  const [b1ProfAbbr, setB1ProfAbbr] = useState('')
  const [b1Room, setB1Room] = useState('')

  const [b2Subject, setB2Subject] = useState('')
  const [b2ProfAbbr, setB2ProfAbbr] = useState('')
  const [b2Room, setB2Room] = useState('')

  useEffect(() => {
    if (!isOpen) return

    if (!initialData || initialData.type === 'empty' || initialData.text === '-') {
      setMode('empty')
      setSubject('')
      setProfessorAbbr('')
      setRoom('')
      setB1Subject('')
      setB1ProfAbbr('')
      setB1Room('')
      setB2Subject('')
      setB2ProfAbbr('')
      setB2Room('')
      setPracticalSpan(2)
    } else if (initialData.type === 'practical') {
      if (initialData.batch1 && initialData.batch2) {
        setPracticalSpan(initialData.rowSpan ?? 1)
        setMode('practical_batch')
        setB1Subject(initialData.batch1.subject || '')
        setB1ProfAbbr(initialData.batch1.profAbbr || '')
        setB1Room(initialData.batch1.room || '')
        setB2Subject(initialData.batch2.subject || '')
        setB2ProfAbbr(initialData.batch2.profAbbr || '')
        setB2Room(initialData.batch2.room || '')
      } else {
        setPracticalSpan(initialData.rowSpan ?? 2)
        setMode('practical_single')
        setSubject(initialData.subject || '')
        setProfessorAbbr(initialData.professorAbbr || '')
        setRoom(initialData.room || '')
      }
    } else {
      setMode('theory')
      setSubject(initialData.subject || '')
      setProfessorAbbr(initialData.professorAbbr || '')
      setRoom(initialData.room || '')
    }
  }, [isOpen, initialData])

  if (!isOpen) return null

  // Subject options
  const subjectOptions = subjects.map(s => ({
    value: s.name,
    label: `${s.name} (${s.code})`,
  }))

  // Professor options with abbreviations
  const professorOptions = professors.map(p => {
    const pName = (p as any)?.profiles?.name || `Faculty #${p.id}`
    const abbr = p.abbreviation || '??'
    return {
      value: abbr,
      label: `${pName} [${abbr}]`,
    }
  })

  const roomOptions = COMMON_ROOMS.map(r => ({ value: r, label: r }))

  function handleSave() {
    if (mode === 'empty') {
      onSave({ type: 'empty', text: '-' })
    } else if (mode === 'practical_batch') {
      const cleanB1Subj = b1Subject.trim()
      const cleanB2Subj = b2Subject.trim()

      if (!cleanB1Subj && !cleanB2Subj) {
        onSave({ type: 'empty', text: '-' })
        onClose()
        return
      }

      const batch1: TimetablePracticalBatch = {
        subject: cleanB1Subj,
        profAbbr: b1ProfAbbr.trim(),
        room: b1Room.trim(),
      }
      const batch2: TimetablePracticalBatch = {
        subject: cleanB2Subj,
        profAbbr: b2ProfAbbr.trim(),
        room: b2Room.trim(),
      }
      onSave({
        type: 'practical',
        batch1,
        batch2,
        rowSpan: practicalSpan,
      })
    } else if (mode === 'practical_single') {
      const cleanSubj = subject.trim()
      if (!cleanSubj || cleanSubj === '-') {
        onSave({ type: 'empty', text: '-' })
        onClose()
        return
      }

      onSave({
        type: 'practical',
        subject: cleanSubj,
        professorAbbr: professorAbbr.trim() || undefined,
        room: room.trim() || undefined,
        rowSpan: practicalSpan,
      })
    } else {
      const cleanSubj = subject.trim()
      if (!cleanSubj || cleanSubj === '-') {
        onSave({ type: 'empty', text: '-' })
        onClose()
        return
      }

      onSave({
        type: 'theory',
        subject: cleanSubj,
        professorAbbr: professorAbbr.trim() || undefined,
        room: room.trim() || undefined,
        rowSpan: 1,
      })
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-blue-50">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">Edit Timetable Cell</h3>
            <p className="text-xs text-blue-700 font-medium">
              Branch: <span className="font-bold">{branch}</span> · Time: <span className="font-bold">{periodLabel}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-500 hover:bg-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-sm">
          {/* Mode Selector */}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Session Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('theory')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-colors ${
                  mode === 'theory' ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                Theory Lecture
              </button>
              <button
                type="button"
                onClick={() => setMode('practical_single')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-colors ${
                  mode === 'practical_single' ? 'bg-pink-600 text-white border-pink-600 shadow-xs' : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                Practical (Single)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('practical_batch')
                  if (!initialData?.rowSpan) setPracticalSpan(1)
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-colors ${
                  mode === 'practical_batch' ? 'bg-purple-600 text-white border-purple-600 shadow-xs' : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                Practical (Batch Split)
              </button>
              <button
                type="button"
                onClick={() => setMode('empty')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-colors ${
                  mode === 'empty' ? 'bg-gray-700 text-white border-gray-700 shadow-xs' : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                Free Period (-)
              </button>
            </div>
          </div>

          {/* Practical Duration Span selector */}
          {(mode === 'practical_single' || mode === 'practical_batch') && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-amber-900 block">Practical Duration</span>
                <span className="text-[11px] text-amber-700">1 Period for batch splits or 2 Periods for spanning labs</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPracticalSpan(1)}
                  className={`px-2.5 py-1 text-xs rounded-lg font-semibold border ${
                    practicalSpan === 1 ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  1 Period
                </button>
                <button
                  type="button"
                  onClick={() => setPracticalSpan(2)}
                  className={`px-2.5 py-1 text-xs rounded-lg font-semibold border ${
                    practicalSpan === 2 ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  2 Periods
                </button>
              </div>
            </div>
          )}

          {/* Theory or Single Practical Form */}
          {(mode === 'theory' || mode === 'practical_single') && (
            <div className="space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-100">
              {subjectOptions.length > 0 ? (
                <Select
                  label="Subject"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  options={subjectOptions}
                  placeholder="Select Subject..."
                />
              ) : (
                <Input
                  label="Subject Name"
                  placeholder="e.g. CHEM, EM, PHY, EG"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                />
              )}

              {professorOptions.length > 0 ? (
                <Select
                  label="Professor [Abbreviation]"
                  value={professorAbbr}
                  onChange={e => setProfessorAbbr(e.target.value)}
                  options={professorOptions}
                  placeholder="Select Faculty..."
                />
              ) : (
                <Input
                  label="Faculty Abbreviation"
                  placeholder="e.g. KVK, RYP, PSS, CDM, PP"
                  value={professorAbbr}
                  onChange={e => setProfessorAbbr(e.target.value)}
                />
              )}

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Select
                    label="Room Number"
                    value={room}
                    onChange={e => setRoom(e.target.value)}
                    options={roomOptions}
                    placeholder="Select room..."
                  />
                </div>
                <div className="flex-1">
                  <Input
                    placeholder="Or type room..."
                    value={room}
                    onChange={e => setRoom(e.target.value)}
                  />
                </div>
              </div>

              {mode === 'practical_single' && (
                <p className="text-xs text-pink-700 bg-pink-50 p-2 rounded-lg font-medium">
                  ✓ Formats as official practical with pink highlight.
                </p>
              )}
            </div>
          )}

          {/* Batch Split Practical Form */}
          {mode === 'practical_batch' && (
            <div className="space-y-4">
              <div className="bg-purple-50/60 p-3 rounded-xl border border-purple-100 space-y-2">
                <span className="text-xs font-bold text-purple-900 uppercase">Batch 1 Allocation</span>
                <Input
                  label="Subject"
                  placeholder="e.g. CHEM or PHY"
                  value={b1Subject}
                  onChange={e => setB1Subject(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label="Faculty [Abbr]"
                    placeholder="e.g. PSS"
                    value={b1ProfAbbr}
                    onChange={e => setB1ProfAbbr(e.target.value)}
                  />
                  <Input
                    label="Lab / Room"
                    placeholder="e.g. 603"
                    value={b1Room}
                    onChange={e => setB1Room(e.target.value)}
                  />
                </div>
              </div>

              <div className="bg-purple-50/60 p-3 rounded-xl border border-purple-100 space-y-2">
                <span className="text-xs font-bold text-purple-900 uppercase">Batch 2 Allocation</span>
                <Input
                  label="Subject"
                  placeholder="e.g. EM or BEEE"
                  value={b2Subject}
                  onChange={e => setB2Subject(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label="Faculty [Abbr]"
                    placeholder="e.g. RYP"
                    value={b2ProfAbbr}
                    onChange={e => setB2ProfAbbr(e.target.value)}
                  />
                  <Input
                    label="Lab / Room"
                    placeholder="e.g. EM LAB"
                    value={b2Room}
                    onChange={e => setB2Room(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Free Slot Info */}
          {mode === 'empty' && (
            <p className="text-gray-500 text-xs italic py-2">
              This cell will be marked as a free period with the official centered dash (-).
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            <Check size={16} className="mr-1.5" />
            Save Cell
          </Button>
        </div>
      </div>
    </div>
  )
}
