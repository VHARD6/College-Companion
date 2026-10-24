import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type {
  MasterTimetable,
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
} from '../../types/timetableStudio'
import type { Subject, Professor, Batch, Class } from '../../types'
import { validateMasterTimetable } from '../../lib/timetableValidation'
import {
  fetchMasterTimetablesList,
  fetchMasterTimetableById,
  saveMasterTimetableDraft,
  publishMasterTimetable,
  duplicateAsNewVersion,
  type MasterTimetableDraftInput,
} from '../../lib/timetablePersistence'
import TimetableGrid from '../../components/timetable/TimetableGrid'
import TimetableCellDrawer from '../../components/timetable/TimetableCellDrawer'
import TimetableConflictList from '../../components/timetable/TimetableConflictList'
import TimetablePrintDocument from '../../components/timetable/TimetablePrintDocument'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import {
  Calendar,
  Eye,
  CheckCircle,
  AlertTriangle,
  Printer,
  X,
  FileCheck,
  Save,
  GitBranch,
  Plus,
} from 'lucide-react'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DEFAULT_PERIODS: MasterTimetablePeriod[] = [
  { id: 1, timetable_id: 1, period_order: 1, start_time: '08:45', end_time: '09:45', is_break: false },
  { id: 2, timetable_id: 1, period_order: 2, start_time: '09:45', end_time: '10:45', is_break: false },
  { id: 3, timetable_id: 1, period_order: 3, start_time: '10:45', end_time: '11:00', is_break: true, break_label: 'Short Recess' },
  { id: 4, timetable_id: 1, period_order: 4, start_time: '11:00', end_time: '12:00', is_break: false },
  { id: 5, timetable_id: 1, period_order: 5, start_time: '12:00', end_time: '13:00', is_break: false },
  { id: 6, timetable_id: 1, period_order: 6, start_time: '13:00', end_time: '13:45', is_break: true, break_label: 'Lunch Break' },
  { id: 7, timetable_id: 1, period_order: 7, start_time: '13:45', end_time: '14:45', is_break: false },
  { id: 8, timetable_id: 1, period_order: 8, start_time: '14:45', end_time: '15:45', is_break: false },
]

export default function TimetableStudioView() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  // Selected Saved Timetable ID (null = new unsaved draft)
  const [selectedTimetableId, setSelectedTimetableId] = useState<number | null>(null)

  // Metadata State
  const [academicYear, setAcademicYear] = useState('2026-27')
  const [semester, setSemester] = useState(5)
  const [cohort, setCohort] = useState('TE')
  const [effectiveDate, setEffectiveDate] = useState('2026-08-01')
  const [headerTitle, setHeaderTitle] = useState('COLLEGE COMPANION ENGINEERING INSTITUTE')
  const [headerSubtitle, setHeaderSubtitle] = useState('DEPARTMENT OF COMPUTER ENGINEERING & TECHNOLOGY')
  const [currentStatus, setCurrentStatus] = useState<'draft' | 'published' | 'archived'>('draft')
  const [currentVersion, setCurrentVersion] = useState(1)

  // Selected Day & Periods
  const [selectedWeekday, setSelectedWeekday] = useState(0) // 0 = Mon
  const [periods, setPeriods] = useState<MasterTimetablePeriod[]>(DEFAULT_PERIODS)

  // Master entries in draft state
  const [entries, setEntries] = useState<MasterTimetableEntry[]>([])

  // Cell Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [activeColumn, setActiveColumn] = useState<MasterTimetableColumn | null>(null)
  const [activePeriodId, setActivePeriodId] = useState<number>(1)
  const [activeEntry, setActiveEntry] = useState<MasterTimetableEntry | null>(null)

  // Preview Modal State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Query 1: Fetch list of all saved master timetables from database
  const {
    data: timetablesList = [],
    isLoading: isListLoading,
    error: listError,
  } = useQuery<MasterTimetable[]>({
    queryKey: ['master-timetables-list'],
    queryFn: () => fetchMasterTimetablesList(),
    retry: false,
  })

  // Detect whether remote database migration 009 is pending
  const isSchemaPending = Boolean(
    listError &&
    ((listError as any)?.code === 'PGRST205' ||
      (listError as any)?.message?.toLowerCase().includes('master_timetables'))
  )

  // Query 2: Fetch full timetable detail if an existing timetable is selected
  const {
    data: loadedTimetable,
    isLoading: isDetailLoading,
  } = useQuery<MasterTimetable | null>({
    queryKey: ['master-timetable-detail', selectedTimetableId],
    enabled: selectedTimetableId !== null,
    queryFn: () => (selectedTimetableId ? fetchMasterTimetableById(selectedTimetableId) : null),
  })

  // Synchronize state when a saved timetable finishes loading
  useEffect(() => {
    if (loadedTimetable) {
      setAcademicYear(loadedTimetable.academic_year)
      setSemester(loadedTimetable.semester)
      setCohort(loadedTimetable.cohort)
      setEffectiveDate(loadedTimetable.effective_date)
      setHeaderTitle(loadedTimetable.header_title || 'COLLEGE COMPANION ENGINEERING INSTITUTE')
      setHeaderSubtitle(loadedTimetable.header_subtitle || 'DEPARTMENT OF COMPUTER ENGINEERING & TECHNOLOGY')
      setCurrentStatus(loadedTimetable.status)
      setCurrentVersion(loadedTimetable.version)
      if (loadedTimetable.periods && loadedTimetable.periods.length > 0) {
        setPeriods(loadedTimetable.periods)
      }
      if (loadedTimetable.entries) {
        setEntries(loadedTimetable.entries)
      }
    }
  }, [loadedTimetable])

  // Reset to a blank new draft
  const handleNewDraft = () => {
    setSelectedTimetableId(null)
    setAcademicYear('2026-27')
    setSemester(5)
    setCohort('TE')
    setEffectiveDate(new Date().toISOString().split('T')[0])
    setHeaderTitle('COLLEGE COMPANION ENGINEERING INSTITUTE')
    setHeaderSubtitle('DEPARTMENT OF COMPUTER ENGINEERING & TECHNOLOGY')
    setCurrentStatus('draft')
    setCurrentVersion(1)
    setPeriods(DEFAULT_PERIODS)
    setEntries([])
    toast.success('Started new blank timetable draft')
  }

  // 1. Fetch academic entities: classes, subjects, professors, batches
  const { data: classes = [], isLoading: isClassesLoading } = useQuery<Class[]>({
    queryKey: ['classes-list-studio'],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, departments(name)').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: subjects = [], isLoading: isSubjectsLoading } = useQuery<Subject[]>({
    queryKey: ['subjects-list-studio'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: professors = [], isLoading: isProfsLoading } = useQuery<(Professor & { abbreviation?: string | null })[]>({
    queryKey: ['professors-list-studio'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('professors')
        .select('id, user_id, department_id, departments(name)')
        .order('id')
      if (error) throw error
      return ((data as unknown) as (Professor & { abbreviation?: string | null })[]) ?? []
    },
  })

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ['all-batches-studio'],
    queryFn: async () => {
      const { data, error } = await supabase.from('batches').select('*').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Filter classes matching current semester
  const filteredClasses = useMemo(() => {
    return classes.filter(c => c.semester === Number(semester))
  }, [classes, semester])

  // Define multi-branch columns from filtered classes
  const columns: MasterTimetableColumn[] = useMemo(() => {
    return filteredClasses.map((cls, idx) => ({
      id: cls.id,
      timetable_id: selectedTimetableId || 1,
      class_id: cls.id,
      column_order: idx + 1,
      display_label: `${cls.name} (${(cls as any)?.departments?.name || 'Dept'})`,
      class: cls,
    }))
  }, [filteredClasses, selectedTimetableId])

  // Lookup maps for validation
  const professorsById = useMemo(() => {
    const map = new Map<number, { name: string; abbreviation: string | null }>()
    professors.forEach(p => {
      const profName = (p as any)?.departments?.name ? `Faculty (${(p as any).departments.name})` : `Faculty #${p.id}`
      map.set(p.id, {
        name: profName,
        abbreviation: p.abbreviation || null,
      })
    })
    return map
  }, [professors])

  const batchesByClassId = useMemo(() => {
    const map = new Map<number, number[]>()
    batches.forEach(b => {
      if (!map.has(b.class_id)) map.set(b.class_id, [])
      map.get(b.class_id)!.push(b.id)
    })
    return map
  }, [batches])

  // Real-Time Validation
  const validation = useMemo(() => {
    return validateMasterTimetable({
      periods,
      columns,
      entries,
      professorsById,
      batchesByClassId,
    })
  }, [periods, columns, entries, professorsById, batchesByClassId])

  // Cell Interaction Handlers
  const handleCellClick = (
    col: MasterTimetableColumn,
    period: MasterTimetablePeriod,
    existing?: MasterTimetableEntry
  ) => {
    setActiveColumn(col)
    setActivePeriodId(period.id)
    setActiveEntry(existing || null)
    setIsDrawerOpen(true)
  }

  const handleFullWidthBreakClick = (
    period: MasterTimetablePeriod,
    existing?: MasterTimetableEntry
  ) => {
    setActiveColumn(null)
    setActivePeriodId(period.id)
    setActiveEntry(existing || null)
    setIsDrawerOpen(true)
  }

  const handleSaveEntry = (newEntry: MasterTimetableEntry) => {
    setEntries(prev => {
      // If updating existing entry
      if (newEntry.id !== undefined) {
        return prev.map(e => (e.id === newEntry.id ? newEntry : e))
      }
      // If replacing an existing entry at identical position
      const filtered = prev.filter(e => {
        const sameDay = e.weekday === newEntry.weekday
        const sameCol = e.column_id === newEntry.column_id
        const sameStart = e.start_period_id === newEntry.start_period_id
        return !(sameDay && sameCol && sameStart)
      })
      const entryWithId: MasterTimetableEntry = {
        ...newEntry,
        id: Date.now(), // Temporary client ID
      }
      return [...filtered, entryWithId]
    })
    toast.success('Slot updated in draft')
  }

  const handleDeleteEntry = (entryId: number | undefined) => {
    if (!entryId) return
    setEntries(prev => prev.filter(e => e.id !== entryId))
    toast.success('Slot removed from draft')
  }

  // Mutation 1: Save Draft to Database
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const draftInput: MasterTimetableDraftInput = {
        id: selectedTimetableId || undefined,
        title: `${cohort} ${academicYear} Sem ${semester}`,
        academic_year: academicYear,
        semester: Number(semester),
        cohort,
        effective_date: effectiveDate,
        header_title: headerTitle,
        header_subtitle: headerSubtitle,
        version: currentVersion,
        periods,
        columns,
        entries,
      }
      return saveMasterTimetableDraft(draftInput, supabase, profile?.id)
    },
    onSuccess: saved => {
      toast.success(`Draft "${saved.title}" saved to database`)
      setSelectedTimetableId(saved.id)
      setCurrentStatus(saved.status)
      setCurrentVersion(saved.version)
      queryClient.invalidateQueries({ queryKey: ['master-timetables-list'] })
      queryClient.invalidateQueries({ queryKey: ['master-timetable-detail', saved.id] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save draft to database')
    },
  })

  // Mutation 2: Publish Master Timetable
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!validation.isValid) {
        throw new Error('Cannot publish timetable with blocking conflicts. Please resolve them first.')
      }
      if (entries.length === 0) {
        throw new Error('Timetable contains no scheduled entries.')
      }

      // Step 1: Ensure current draft edits are saved to the database first
      const draftInput: MasterTimetableDraftInput = {
        id: selectedTimetableId || undefined,
        title: `${cohort} ${academicYear} Sem ${semester}`,
        academic_year: academicYear,
        semester: Number(semester),
        cohort,
        effective_date: effectiveDate,
        header_title: headerTitle,
        header_subtitle: headerSubtitle,
        version: currentVersion,
        periods,
        columns,
        entries,
      }
      const saved = await saveMasterTimetableDraft(draftInput, supabase, profile?.id)

      // Step 2: Publish and synchronize to timetable_slots
      const result = await publishMasterTimetable(saved.id, supabase)
      return result
    },
    onSuccess: ({ timetable, projectedSlots }) => {
      toast.success(
        `Timetable published! ${projectedSlots} slots synchronized to operational attendance schedule.`
      )
      setSelectedTimetableId(timetable.id)
      setCurrentStatus('published')
      queryClient.invalidateQueries({ queryKey: ['master-timetables-list'] })
      queryClient.invalidateQueries({ queryKey: ['master-timetable-detail', timetable.id] })
      queryClient.invalidateQueries({ queryKey: ['all-timetable-slots'] })
      queryClient.invalidateQueries({ queryKey: ['published-master-timetable'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Publication failed')
    },
  })

  // Mutation 3: Create Revision Draft from a Published Timetable
  const newVersionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTimetableId) throw new Error('No timetable selected')
      return duplicateAsNewVersion(selectedTimetableId, supabase, profile?.id)
    },
    onSuccess: newDraft => {
      toast.success(`Created new revision draft: ${newDraft.title}`)
      setSelectedTimetableId(newDraft.id)
      setCurrentStatus('draft')
      setCurrentVersion(newDraft.version)
      queryClient.invalidateQueries({ queryKey: ['master-timetables-list'] })
      queryClient.invalidateQueries({ queryKey: ['master-timetable-detail', newDraft.id] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create revision')
    },
  })

  // Current draft metadata object for print document
  const currentTimetableMeta: MasterTimetable = {
    id: selectedTimetableId || 1,
    title: `${cohort} ${academicYear} Sem ${semester}`,
    academic_year: academicYear,
    semester: Number(semester),
    cohort,
    effective_date: effectiveDate,
    status: currentStatus,
    version: currentVersion,
    header_title: headerTitle,
    header_subtitle: headerSubtitle,
    periods,
    columns,
    entries,
  }

  const isLoading =
    isClassesLoading || isSubjectsLoading || isProfsLoading || isDetailLoading

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const isPublished = currentStatus === 'published'

  return (
    <div className="space-y-4">
      {/* Pending Schema Warning if Migration 009 not applied to Supabase */}
      {isSchemaPending && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-amber-900 text-xs">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-sm text-amber-800">
              Database Migration 009 Pending on Remote Supabase
            </p>
            <p>
              The <code>master_timetables</code> database table has not been created on the target database yet.
              In-memory editing, conflict validation, and layout preview are fully functional. Remote persistence and publishing require applying{' '}
              <code>supabase/migrations/009_timetable_studio.sql</code>.
            </p>
          </div>
        </div>
      )}

      {/* 1. Header Toolbar with Timetable Selector & Actions */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2.5 rounded-xl shadow-xs">
            <Calendar size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900">
                Timetable Studio
              </h2>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full capitalize ${
                  isPublished
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {currentStatus} (v{currentVersion})
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Multi-branch master grid editor with conflict detection & print-ready export.
            </p>
          </div>
        </div>

        {/* Timetable Selector Dropdown */}
        <div className="flex items-center gap-2 flex-wrap">
          {!isListLoading && timetablesList.length > 0 && (
            <div className="w-56">
              <select
                value={selectedTimetableId ?? ''}
                onChange={e => {
                  const val = e.target.value
                  if (val === '') {
                    handleNewDraft()
                  } else {
                    setSelectedTimetableId(Number(val))
                  }
                }}
                className="w-full text-xs font-semibold rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">+ New Timetable Draft</option>
                {timetablesList.map(t => (
                  <option key={t.id} value={t.id}>
                    [{t.status.toUpperCase()}] {t.title} (v{t.version})
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedTimetableId !== null && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleNewDraft}
              className="flex items-center gap-1.5 text-xs"
              title="Start a new blank timetable"
            >
              <Plus size={14} /> New
            </Button>
          )}

          {/* Preview Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsPreviewOpen(true)}
            className="flex items-center gap-1.5 text-xs"
          >
            <Eye size={14} />
            Preview
          </Button>

          {/* Save Draft Button (or Create Revision if Published) */}
          {isPublished ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => newVersionMutation.mutate()}
              loading={newVersionMutation.isPending}
              className="flex items-center gap-1.5 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
              title="Create a new editable revision draft from this published version"
            >
              <GitBranch size={14} />
              New Revision
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveDraftMutation.mutate()}
              loading={saveDraftMutation.isPending}
              disabled={saveDraftMutation.isPending}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"
            >
              <Save size={14} />
              Save Draft
            </Button>
          )}

          {/* Publish Button */}
          <Button
            size="sm"
            variant="primary"
            onClick={() => publishMutation.mutate()}
            loading={publishMutation.isPending}
            disabled={!validation.isValid || entries.length === 0 || publishMutation.isPending}
            className="flex items-center gap-1.5 text-xs font-semibold"
          >
            <CheckCircle size={14} />
            Publish
          </Button>
        </div>
      </div>

      {/* Published Notice Banner */}
      {isPublished && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center justify-between text-xs text-blue-800">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-blue-600 shrink-0" />
            <span>
              This timetable is <strong>Published (v{currentVersion})</strong> and active for students.
              Click <strong>New Revision</strong> to author subsequent changes without corrupting published schedules.
            </span>
          </div>
        </div>
      )}

      {/* 2. Metadata Controls Card */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Input
            label="Academic Year"
            value={academicYear}
            onChange={e => setAcademicYear(e.target.value)}
            placeholder="e.g. 2026-27"
          />

          <Select
            label="Semester"
            value={semester}
            onChange={e => setSemester(Number(e.target.value))}
            options={[1, 2, 3, 4, 5, 6, 7, 8].map(s => ({ value: s, label: `Semester ${s}` }))}
          />

          <Input
            label="Cohort / Year"
            value={cohort}
            onChange={e => setCohort(e.target.value)}
            placeholder="e.g. TE, BE"
          />

          <Input
            label="With Effect From (W.E.F.)"
            type="date"
            value={effectiveDate}
            onChange={e => setEffectiveDate(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Input
            label="Institution Header"
            value={headerTitle}
            onChange={e => setHeaderTitle(e.target.value)}
            placeholder="e.g. COLLEGE COMPANION ENGINEERING INSTITUTE"
          />
          <Input
            label="Department / Subtitle"
            value={headerSubtitle}
            onChange={e => setHeaderSubtitle(e.target.value)}
            placeholder="e.g. DEPARTMENT OF COMPUTER ENGINEERING & TECHNOLOGY"
          />
        </div>

        {/* Branch / Column Indicators */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
          <div>
            <span className="font-semibold text-gray-800">Included Branches ({columns.length}): </span>
            {columns.length > 0 ? (
              columns.map(c => (
                <span
                  key={c.id}
                  className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-medium mr-1.5 inline-block"
                >
                  {c.display_label}
                </span>
              ))
            ) : (
              <span className="text-amber-600 font-medium">
                No classes configured for Semester {semester}. Create classes in Admin &gt; Structure.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold ${
                validation.isValid
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {validation.isValid ? (
                <>
                  <CheckCircle size={12} /> Conflict-Free
                </>
              ) : (
                <>
                  <AlertTriangle size={12} /> {validation.errors.length} Conflict(s)
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Validation Feedback Box */}
      <TimetableConflictList validation={validation} />

      {/* 4. Day Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {WEEKDAYS.map((dayName, idx) => {
          const isSelected = selectedWeekday === idx
          const dayEntriesCount = entries.filter(e => e.weekday === idx).length

          return (
            <button
              key={dayName}
              onClick={() => setSelectedWeekday(idx)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-2 ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span>{dayName}</span>
              {dayEntriesCount > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isSelected ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {dayEntriesCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 5. Master Timetable Grid */}
      {columns.length > 0 ? (
        <TimetableGrid
          periods={periods}
          columns={columns}
          entries={entries}
          currentWeekday={selectedWeekday}
          validation={validation}
          subjects={subjects}
          professors={professors}
          batches={batches}
          onCellClick={handleCellClick}
          onFullWidthBreakClick={handleFullWidthBreakClick}
        />
      ) : (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
          <p className="text-gray-400 font-medium">
            Please configure classes for Semester {semester} to render the branch grid columns.
          </p>
        </div>
      )}

      {/* 6. Cell Configuration Drawer */}
      <TimetableCellDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onSave={handleSaveEntry}
        onDelete={handleDeleteEntry}
        periods={periods}
        column={activeColumn}
        currentWeekday={selectedWeekday}
        existingEntry={activeEntry}
        defaultStartPeriodId={activePeriodId}
        subjects={subjects}
        professors={professors}
        batches={batches}
      />

      {/* 7. High-Fidelity Print & PNG Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2">
                <FileCheck size={20} className="text-blue-600" />
                <h3 className="font-bold text-gray-900 text-base">
                  Master Timetable Print Document Preview
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5"
                >
                  <Printer size={15} /> Print / Save PDF
                </Button>
                <button
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Body (Scrollable document view) */}
            <div className="p-6 overflow-y-auto flex-1 bg-gray-100/60">
              <TimetablePrintDocument
                timetable={currentTimetableMeta}
                periods={periods}
                columns={columns}
                entries={entries}
                selectedWeekday={selectedWeekday}
                subjects={subjects}
                professors={professors}
                batches={batches}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
