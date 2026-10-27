import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Subject, Professor } from '../../types'
import type { MasterTimetableGridData, TimetableCellData } from '../../types/timetableMaker'
import {
  createDefaultMasterTimetable,
  DEFAULT_BRANCHES,
} from '../../lib/timetableDefaults'
import {
  publishOfficialTimetable,
  fetchPublishedDates,
  fetchPublishedTimetableByDate,
  formatDateForOfficialDisplay,
} from '../../lib/timetableImagePersistence'
import { renderTimetableToDataUrl } from '../../lib/timetableImageRenderer'
import OfficialTimetableDocument from '../../components/timetable/OfficialTimetableDocument'
import OfficialCellEditorModal from '../../components/timetable/OfficialCellEditorModal'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import toast from 'react-hot-toast'
import {
  Calendar,
  Eye,
  Send,
  RotateCcw,
  Download,
  X,
  FileCheck,
  Megaphone,
} from 'lucide-react'

export default function TimetableStudioView() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  // Date selection (default today in YYYY-MM-DD)
  const todayISO = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState<string>(todayISO)

  // Daily announcement
  const [announcement, setAnnouncement] = useState('')

  // Grid Data State initialized with official college template
  const [gridData, setGridData] = useState<MasterTimetableGridData>(() =>
    createDefaultMasterTimetable(formatDateForOfficialDisplay(todayISO))
  )

  // Cell Editor Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null)
  const [activeBranch, setActiveBranch] = useState('')
  const [activePeriodLabel, setActivePeriodLabel] = useState('')
  const [activeCellData, setActiveCellData] = useState<TimetableCellData | undefined>()

  // Image Preview Modal State
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)

  // Sync date change with gridData.date
  useEffect(() => {
    setGridData(prev => ({
      ...prev,
      date: formatDateForOfficialDisplay(selectedDate),
    }))
  }, [selectedDate])

  // Query: Reference subjects for dropdowns
  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ['subjects-for-studio'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Query: Reference professors with abbreviation for dropdowns
  const { data: professors = [] } = useQuery<(Professor & { abbreviation?: string | null })[]>({
    queryKey: ['professors-for-studio'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('professors')
        .select('*, profiles(name), departments(name)')
      if (error) throw error
      return data ?? []
    },
  })

  // Query: List of previously published dates
  const {
    data: publishedDates = [],
    refetch: refetchDates,
  } = useQuery({
    queryKey: ['published-timetable-dates'],
    queryFn: () => fetchPublishedDates('FY BTECH'),
  })

  // Load template from previously published date if selected
  async function loadFromPublishedDate(targetDate: string) {
    try {
      const pub = await fetchPublishedTimetableByDate(targetDate, 'FY BTECH')
      if (pub?.grid_data) {
        setGridData({
          ...pub.grid_data,
          date: formatDateForOfficialDisplay(selectedDate),
        })
        if (pub.announcement) setAnnouncement(pub.announcement)
        toast.success(`Loaded template from ${formatDateForOfficialDisplay(targetDate)}`)
      } else {
        toast.error('No grid data found for this date')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load timetable')
    }
  }

  // Handle clicking a cell on the official layout
  function handleCellClick(periodId: number, branchIdx: number) {
    const branch = gridData.branches[branchIdx] || DEFAULT_BRANCHES[branchIdx] || 'Branch'
    const period = gridData.periods.find(p => p.id === periodId)
    const periodLabel = period ? `${period.startTime} - ${period.endTime}` : `Period #${periodId}`
    const cellKey = `${periodId}_${branchIdx}`

    setActiveCellKey(cellKey)
    setActiveBranch(branch)
    setActivePeriodLabel(periodLabel)
    setActiveCellData(gridData.cells[cellKey])
    setIsEditorOpen(true)
  }

  // Save updated cell into grid state
  function handleSaveCell(updatedCell: TimetableCellData) {
    if (!activeCellKey) return
    setGridData(prev => ({
      ...prev,
      cells: {
        ...prev.cells,
        [activeCellKey]: updatedCell,
      },
    }))
  }

  // Preview PNG generation
  async function handleGeneratePreview() {
    setIsGeneratingPreview(true)
    try {
      const dataUrl = await renderTimetableToDataUrl(gridData, 2)
      setPreviewImageUrl(dataUrl)
    } catch (err: any) {
      toast.error('Failed to generate preview image')
      console.error(err)
    } finally {
      setIsGeneratingPreview(false)
    }
  }

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      return await publishOfficialTimetable({
        gridData,
        date: selectedDate,
        academicYear: gridData.academicYear,
        semester: gridData.semester === 'I' ? 1 : Number(gridData.semester) || 1,
        className: gridData.className,
        announcement,
        adminProfileId: profile?.id,
      })
    },
    onSuccess: (saved) => {
      toast.success(
        `Official Master Timetable for ${formatDateForOfficialDisplay(saved.timetable_date)} published!`,
        { duration: 4000 }
      )
      refetchDates()
      queryClient.invalidateQueries({ queryKey: ['published-timetable-dates'] })
      queryClient.invalidateQueries({ queryKey: ['published-master-timetable'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to publish timetable')
    },
  })

  return (
    <div className="space-y-6 pb-20">
      {/* ─── Control Bar ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="text-blue-600" size={20} />
              Timetable Maker (Official Format)
            </h2>
            <p className="text-xs text-gray-500">
              Build and publish daily date-specific timetables as official high-resolution images for all BTech branches.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setGridData(createDefaultMasterTimetable(formatDateForOfficialDisplay(selectedDate)))
                toast.success('Reset to official FY BTech default template')
              }}
            >
              <RotateCcw size={14} className="mr-1.5" />
              Reset Default
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleGeneratePreview}
              loading={isGeneratingPreview}
            >
              <Eye size={14} className="mr-1.5" />
              Preview Image
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (publishMutation.isPending || isGeneratingPreview) return
                publishMutation.mutate()
              }}
              loading={publishMutation.isPending}
              disabled={publishMutation.isPending || isGeneratingPreview}
            >
              <Send size={14} className="mr-1.5" />
              Publish Timetable
            </Button>
          </div>
        </div>

        {/* Date, Class, & Announcement Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-gray-100">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Timetable Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full text-xs rounded-xl border border-gray-300 px-3 py-2 bg-white font-medium"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Class / Cohort</label>
            <Input
              value={gridData.className}
              onChange={e => setGridData(prev => ({ ...prev, className: e.target.value }))}
              placeholder="e.g. FY BTECH"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Academic Year & SEM</label>
            <div className="flex gap-2">
              <input
                value={gridData.academicYear}
                onChange={e => setGridData(prev => ({ ...prev, academicYear: e.target.value }))}
                className="w-full text-xs rounded-xl border border-gray-300 px-3 py-2 bg-white"
                placeholder="2026-27"
              />
              <input
                value={gridData.semester}
                onChange={e => setGridData(prev => ({ ...prev, semester: e.target.value }))}
                className="w-20 text-xs rounded-xl border border-gray-300 px-3 py-2 bg-white text-center font-bold"
                placeholder="SEM"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Load Published Template</label>
            <select
              onChange={e => e.target.value && loadFromPublishedDate(e.target.value)}
              defaultValue=""
              className="w-full text-xs rounded-xl border border-gray-300 px-3 py-2 bg-white text-gray-700"
            >
              <option value="">Select past date...</option>
              {publishedDates.map(p => (
                <option key={p.timetable_date} value={p.timetable_date}>
                  {formatDateForOfficialDisplay(p.timetable_date)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Daily Announcement field */}
        <div className="pt-2 border-t border-gray-100 flex items-start gap-2">
          <Megaphone size={18} className="text-amber-600 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <Input
              value={announcement}
              onChange={e => setAnnouncement(e.target.value)}
              placeholder="Daily Announcement for students (e.g. Practical Batch 1 to report to Lab 703; Submission deadline 4:00 PM)"
            />
          </div>
        </div>
      </div>

      {/* ─── Interactive Official Layout Document ───────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
            <FileCheck size={16} className="text-blue-600" />
            Official Timetable Grid (Click any cell to edit)
          </span>
          <span className="text-xs text-gray-500 italic">
            Output matches college official master format with MES crest & logos
          </span>
        </div>

        <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <OfficialTimetableDocument
            grid={gridData}
            interactive={true}
            onCellClick={handleCellClick}
          />
        </div>
      </div>

      {/* ─── Cell Editor Modal ──────────────────────────────────── */}
      <OfficialCellEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        branch={activeBranch}
        periodLabel={activePeriodLabel}
        initialData={activeCellData}
        subjects={subjects}
        professors={professors}
        onSave={handleSaveCell}
      />

      {/* ─── High-Res Image Preview Modal ──────────────────────── */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <Eye size={18} className="text-blue-600" />
                Rendered High-Resolution Image Preview ({formatDateForOfficialDisplay(selectedDate)})
              </h3>
              <div className="flex items-center gap-2">
                <a
                  href={previewImageUrl}
                  download={`Timetable_${selectedDate}.png`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 bg-white"
                >
                  <Download size={14} />
                  Download PNG
                </a>
                <button
                  onClick={() => setPreviewImageUrl(null)}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-auto flex-1 flex justify-center bg-gray-100">
              <img
                src={previewImageUrl}
                alt="Generated Timetable Preview"
                className="max-w-full h-auto object-contain border border-gray-300 shadow-md rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
