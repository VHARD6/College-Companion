import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logTimetableDiagnostic } from '../../lib/errors'
import TopBar from '../../components/ui/TopBar'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { WEEKDAY_FULL, formatTime, todayWeekday } from '../../lib/utils'
import {
  AlertCircle,
  RefreshCw,
  Calendar,
  FileText,
  Download,
  Maximize2,
  X,
  Megaphone,
  CheckCircle2,
} from 'lucide-react'
import {
  fetchPublishedTimetableByDate,
  fetchLatestPublishedTimetable,
  fetchPublishedDates,
  formatDateForOfficialDisplay,
  downloadTimetableImage,
} from '../../lib/timetableImagePersistence'

export default function TimetablePage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState<'schedule' | 'master'>('schedule')

  // Today ISO date (YYYY-MM-DD)
  const todayISO = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState<string>(todayISO)

  // Fullscreen Zoom Modal State
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)

  // 1. Student Enrollment Query
  const {
    data: student,
    isError: isStudentError,
    error: studentError,
    refetch: refetchStudent,
  } = useQuery({
    queryKey: ['my-student', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*').eq('user_id', profile!.id).maybeSingle()
      if (error) {
        logTimetableDiagnostic('student_enrollment', error, 'student_enrollment')
        const err: any = new Error(error.message)
        err.stage = 'student_enrollment'
        err.code = error.code
        err.details = error.details
        err.hint = error.hint
        throw err
      }
      return data
    },
  })

  // 2. Operational Timetable Slots Query (My Schedule)
  const {
    data: slots,
    isLoading,
    isError: isSlotsError,
    error: slotsError,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: ['timetable', student?.class_id, student?.batch_id],
    enabled: !!student && !!student.class_id,
    queryFn: async () => {
      if (!student?.class_id) return []

      const assignmentIds = await getAssignmentIds(student.class_id, student.batch_id)
      if (assignmentIds.length === 0) return []

      const { data, error } = await supabase
        .from('timetable_slots')
        .select(`
          *,
          teaching_assignments(
            subjects(name, code, type),
            professors(id, departments(name))
          )
        `)
        .in('teaching_assignment_id', assignmentIds)
        .order('weekday')
        .order('start_time')

      if (error) {
        logTimetableDiagnostic('timetable_slots', error, 'timetable_slots')
        const err: any = new Error(error.message)
        err.stage = 'timetable_slots'
        err.code = error.code
        err.details = error.details
        err.hint = error.hint
        throw err
      }
      return data ?? []
    },
  })

  // Error handling for My Schedule
  const activeError = isStudentError ? studentError : isSlotsError ? slotsError : null
  const hasError = !!activeError

  const errorStage = (activeError as any)?.stage ?? (isStudentError ? 'student_enrollment' : 'timetable_slots')
  const stageDescription = {
    student_enrollment: 'Loading student enrollment record (students table)',
    teaching_assignments: 'Loading teaching assignments (teaching_assignments table)',
    timetable_slots: 'Loading timetable slots & embedded relations (timetable_slots query)',
  }[errorStage as 'student_enrollment' | 'teaching_assignments' | 'timetable_slots'] ?? 'Loading timetable'

  const errorCode = (activeError as any)?.code
  const errorDetails = (activeError as any)?.details
  const errorHint = (activeError as any)?.hint
  const errorMessage = (activeError as any)?.message || 'Database query error'

  const today = todayWeekday()

  // 3. Published Timetable Dates Query (for Calendar picker)
  const {
    data: publishedDates = [],
    refetch: refetchPublishedDates,
  } = useQuery({
    queryKey: ['published-timetable-dates'],
    queryFn: () => fetchPublishedDates('FY BTECH'),
  })

  // If initial selectedDate has no timetable, auto-select the latest published date if available
  useEffect(() => {
    if (publishedDates.length > 0) {
      const hasCurrent = publishedDates.some(p => p.timetable_date === selectedDate)
      if (!hasCurrent) {
        setSelectedDate(publishedDates[0].timetable_date)
      }
    }
  }, [publishedDates])

  // 4. Query Published Master Timetable for selected date
  const {
    data: currentTimetable,
    isLoading: isTimetableLoading,
    isError: isTimetableError,
    error: timetableError,
    refetch: refetchTimetable,
  } = useQuery({
    queryKey: ['published-master-timetable', selectedDate],
    queryFn: async () => {
      // First check selected date
      const exact = await fetchPublishedTimetableByDate(selectedDate, 'FY BTECH')
      if (exact) return exact

      // If no exact match and selected date is today, check latest available
      if (selectedDate === todayISO) {
        return await fetchLatestPublishedTimetable('FY BTECH')
      }
      return null
    },
    retry: false,
  })

  // Group slots by weekday for My Schedule
  const byDay = WEEKDAY_FULL.map((day, idx) => ({
    day,
    idx,
    slots: slots?.filter(s => s.weekday === idx) ?? [],
  }))

  return (
    <div className="pb-16">
      <TopBar title="Timetable" showBack />

      {/* Tab Switcher: My Schedule vs Master Timetable */}
      <div className="px-4 pt-3">
        <div className="flex bg-gray-200/80 p-1 rounded-xl max-w-sm mx-auto">
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'schedule'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Calendar size={14} />
            My Schedule
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('master')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'master'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText size={14} />
            Master Timetable
          </button>
        </div>
      </div>

      {activeTab === 'master' ? (
        <div className="p-4 space-y-4 max-w-4xl mx-auto">
          {/* ─── Calendar / Date Selector Bar ────────────────────── */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                  <Calendar size={16} className="text-blue-600" />
                  Master Timetable (Official College Format)
                </h3>
                <p className="text-xs text-gray-500">
                  Daily master timetable published for all BTech branches. Select a date to view.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="text-xs rounded-xl border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    refetchPublishedDates()
                    refetchTimetable()
                  }}
                  title="Check for updates"
                >
                  <RefreshCw size={13} />
                </Button>
              </div>
            </div>

            {/* Quick date chips if published dates exist */}
            {publishedDates.length > 0 && (
              <div className="pt-2 border-t border-gray-100 flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">
                  Dates:
                </span>
                {publishedDates.slice(0, 6).map(p => (
                  <button
                    key={p.timetable_date}
                    onClick={() => setSelectedDate(p.timetable_date)}
                    className={`text-xs px-2.5 py-1 rounded-lg border font-semibold whitespace-nowrap transition-colors ${
                      selectedDate === p.timetable_date
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {formatDateForOfficialDisplay(p.timetable_date)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ─── Daily Announcement Banner ────────────────────────── */}
          {currentTimetable?.announcement && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-start gap-2.5 shadow-xs">
              <Megaphone size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs">
                <span className="font-bold text-amber-900 block mb-0.5">Announcement for {formatDateForOfficialDisplay(currentTimetable.timetable_date)}:</span>
                <p className="text-amber-800 leading-relaxed">{currentTimetable.announcement}</p>
              </div>
            </div>
          )}

          {/* ─── Timetable Display State ──────────────────────────── */}
          {isTimetableLoading ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-100 shadow-xs">
              <Spinner className="h-8 w-8 text-blue-600 mb-2" />
              <p className="text-xs text-gray-500 font-medium">Loading published master timetable...</p>
            </div>
          ) : isTimetableError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-3">
              <AlertCircle size={24} className="text-red-500 mx-auto" />
              <div>
                <h4 className="font-bold text-red-900 text-sm">Failed to load timetable</h4>
                <p className="text-xs text-red-600 mt-1">
                  {(timetableError as any)?.message || 'Database query error'}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetchTimetable()}>
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </div>
          ) : !currentTimetable ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-200 shadow-xs space-y-3">
              <div className="bg-blue-50 text-blue-600 p-3 rounded-2xl w-fit mx-auto">
                <Calendar size={28} />
              </div>
              <div>
                <h4 className="font-bold text-gray-900 text-sm">
                  No Timetable Published for {formatDateForOfficialDisplay(selectedDate)}
                </h4>
                <p className="text-xs text-gray-500 max-w-md mx-auto mt-1">
                  The college administration has not published a master timetable for this date yet.
                  You can check your weekly timetable in the <strong>My Schedule</strong> tab.
                </p>
              </div>

              {publishedDates.length > 0 && (
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setSelectedDate(publishedDates[0].timetable_date)}
                    className="text-xs"
                  >
                    <CheckCircle2 size={14} className="mr-1.5" />
                    View Latest Timetable ({formatDateForOfficialDisplay(publishedDates[0].timetable_date)})
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* ─── Published High-Resolution Image Card ──────────── */
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden space-y-3">
              {/* Header & Actions */}
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-gray-50">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-gray-900 text-sm">
                      Master Timetable — {formatDateForOfficialDisplay(currentTimetable.timetable_date)}
                    </h4>
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {currentTimetable.class_name}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    A. Y. {currentTimetable.academic_year} · Semester {currentTimetable.semester}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsFullscreenOpen(true)}
                    className="text-xs"
                  >
                    <Maximize2 size={13} className="mr-1" />
                    Fullscreen / Zoom
                  </Button>

                  <button
                    type="button"
                    onClick={() => downloadTimetableImage(currentTimetable.image_url, `Timetable_${currentTimetable.timetable_date}.png`)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-xl transition-colors shadow-xs"
                  >
                    <Download size={13} />
                    Download PNG
                  </button>
                </div>
              </div>

              {/* Responsive Image Container */}
              <div
                className="p-2 md:p-4 bg-gray-100 flex justify-center cursor-zoom-in"
                onClick={() => setIsFullscreenOpen(true)}
                title="Click to open fullscreen zoom"
              >
                <img
                  src={currentTimetable.image_url}
                  alt={`Master Timetable for ${currentTimetable.timetable_date}`}
                  className="max-w-full h-auto rounded shadow-sm border border-gray-300"
                />
              </div>

              <div className="p-3 text-center text-xs text-gray-400">
                Tap or click image to open fullscreen zoomable view
              </div>
            </div>
          )}

          {/* ─── Fullscreen Zoom Modal ──────────────────────────── */}
          {isFullscreenOpen && currentTimetable && (
            <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
              <div className="p-3 flex items-center justify-between bg-black/70 text-white border-b border-gray-800">
                <span className="text-xs font-bold">
                  Master Timetable ({formatDateForOfficialDisplay(currentTimetable.timetable_date)})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadTimetableImage(currentTimetable.image_url, `Timetable_${currentTimetable.timetable_date}.png`)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-lg"
                  >
                    <Download size={13} />
                    Download
                  </button>
                  <button
                    onClick={() => setIsFullscreenOpen(false)}
                    className="p-1 rounded-lg text-gray-300 hover:text-white"
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-2 flex items-center justify-center">
                <img
                  src={currentTimetable.image_url}
                  alt="Fullscreen Timetable"
                  className="max-w-none w-auto max-h-none select-none"
                  style={{ minWidth: '950px' }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ─── My Schedule Tab (Personal Schedule) ─────────────── */
        <div className="p-4 space-y-4">
          {hasError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-red-800">
                <AlertCircle size={20} className="text-red-500 shrink-0" />
                <p className="font-semibold text-sm">Failed to load timetable</p>
              </div>

              <div className="bg-white/90 rounded-xl p-3 border border-red-100 space-y-1.5 text-left text-xs">
                <div>
                  <span className="font-semibold text-gray-700">Failed Operation: </span>
                  <span className="font-medium text-red-700">{stageDescription}</span>
                </div>
                {errorCode && (
                  <div>
                    <span className="font-semibold text-gray-700">PostgreSQL / API Code: </span>
                    <span className="font-mono text-gray-900 bg-gray-100 px-1 py-0.5 rounded">{errorCode}</span>
                  </div>
                )}
                <div>
                  <span className="font-semibold text-gray-700">Message: </span>
                  <span className="text-red-600">{errorMessage}</span>
                </div>
                {errorDetails && (
                  <div>
                    <span className="font-semibold text-gray-700">Details: </span>
                    <span className="text-gray-600 font-mono text-[11px]">{errorDetails}</span>
                  </div>
                )}
                {errorHint && (
                  <div>
                    <span className="font-semibold text-gray-700">Hint: </span>
                    <span className="text-gray-600 font-mono text-[11px]">{errorHint}</span>
                  </div>
                )}
              </div>

              <div className="text-center pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (isStudentError) refetchStudent()
                    if (isSlotsError) refetchSlots()
                  }}
                >
                  <RefreshCw size={14} className="mr-1.5" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {!hasError && !student?.class_id && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
              <p className="font-semibold text-amber-900 text-sm">Enrollment Pending</p>
              <p className="text-xs text-amber-700 mt-1">
                You are not assigned to a class division yet. Your timetable will be available here once your class is assigned.
              </p>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-8 w-8" />
            </div>
          ) : hasError ? null : (
            byDay.map(({ day, idx, slots: daySlots }) => (
              <div key={day}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className={`text-sm font-semibold ${idx === today ? 'text-blue-600' : 'text-gray-500'} uppercase tracking-wide`}>
                    {day}
                  </h2>
                  {idx === today && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Today</span>
                  )}
                </div>

                {daySlots.length === 0 ? (
                  <p className="text-xs text-gray-400 ml-1 mb-2">No classes</p>
                ) : (
                  <div className="space-y-2">
                    {daySlots.map(slot => {
                      const ta = slot.teaching_assignments as any
                      const subject = ta?.subjects
                      const profDept = ta?.professors?.departments?.name
                      const profDisplayName = ta?.professors?.profiles?.name || (profDept ? `Faculty (${profDept})` : 'Faculty')
                      return (
                        <div key={slot.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                          {/* Time column */}
                          <div className="text-center min-w-[56px]">
                            <p className="text-xs font-bold text-gray-700">{formatTime(slot.start_time)}</p>
                            <p className="text-xs text-gray-400">{formatTime(slot.end_time)}</p>
                          </div>
                          <div className="w-px h-8 bg-gray-200" />
                          {/* Subject info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900 truncate">{subject?.name}</p>
                            <p className="text-xs text-gray-500">{profDisplayName} · {slot.room ?? 'Room TBA'}</p>
                          </div>
                          {/* Subject type badge */}
                          <span className="text-xs text-gray-400 capitalize">{subject?.type}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Get all teaching assignment IDs for a class (and optionally batch) */
async function getAssignmentIds(classId: number, batchId: number | null): Promise<number[]> {
  if (!classId) return []
  const query = supabase
    .from('teaching_assignments')
    .select('id, batch_id')
    .eq('class_id', classId)

  const { data, error } = await query
  if (error) {
    logTimetableDiagnostic('teaching_assignments', error, 'teaching_assignments')
    const err: any = new Error(error.message)
    err.stage = 'teaching_assignments'
    err.code = error.code
    err.details = error.details
    err.hint = error.hint
    throw err
  }
  if (!data) return []
  // Include assignments with no batch, or assignments matching this student's batch
  return data
    .filter(a => a.batch_id === null || a.batch_id === batchId)
    .map(a => a.id)
}
