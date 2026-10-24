import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logTimetableDiagnostic } from '../../lib/errors'
import TopBar from '../../components/ui/TopBar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import { WEEKDAY_FULL, formatTime } from '../../lib/utils'
import { Trash2, AlertCircle, RefreshCw, LayoutGrid, ListFilter } from 'lucide-react'
import TimetableStudioView from './TimetableStudioView'

export default function TimetablePage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'studio' | 'legacy'>('studio')
  const [assignmentId, setAssignmentId] = useState('')
  const [weekday, setWeekday] = useState('0')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [room, setRoom] = useState('')

  // Fetch teaching assignments
  const { data: assignments } = useQuery({
    queryKey: ['assignments-for-timetable'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select(`
          id,
          professors(profiles(name)),
          subjects(name, code),
          classes(name),
          batches(name)
        `)
      if (error) {
        logTimetableDiagnostic('assignments_for_timetable', error, 'admin_assignments')
        throw error
      }
      return data ?? []
    },
  })

  // Fetch all timetable slots
  const {
    data: slots,
    isLoading,
    isError: isSlotsError,
    error: slotsError,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: ['all-timetable-slots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('timetable_slots')
        .select(`
          id,
          weekday,
          start_time,
          end_time,
          room,
          teaching_assignments(
            id,
            professors(profiles(name)),
            subjects(name, code),
            classes(name),
            batches(name)
          )
        `)
        .order('weekday')
        .order('start_time')

      if (error) {
        logTimetableDiagnostic('all_timetable_slots', error, 'admin_all_slots')
        const err: any = new Error(error.message)
        err.stage = 'admin_all_slots'
        err.code = error.code
        err.details = error.details
        err.hint = error.hint
        throw err
      }
      return data ?? []
    },
  })

  // Add slot mutation
  const addSlotMutation = useMutation({
    mutationFn: async () => {
      if (!assignmentId || !startTime || !endTime) {
        throw new Error('Assignment, start time, and end time are required.')
      }
      if (startTime >= endTime) {
        throw new Error('End time must be later than start time.')
      }
      const { error } = await supabase.from('timetable_slots').insert({
        teaching_assignment_id: Number(assignmentId),
        weekday: Number(weekday),
        start_time: startTime,
        end_time: endTime,
        room: room.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Timetable slot scheduled!')
      setRoom('')
      queryClient.invalidateQueries({ queryKey: ['all-timetable-slots'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Delete slot mutation
  const deleteSlotMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('timetable_slots').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Slot removed')
      queryClient.invalidateQueries({ queryKey: ['all-timetable-slots'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Group slots by weekday
  const slotsByDay: Record<number, typeof slots> = {}
  slots?.forEach(slot => {
    if (!slotsByDay[slot.weekday]) slotsByDay[slot.weekday] = []
    slotsByDay[slot.weekday]!.push(slot)
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <TopBar title="Timetable Management" showBack />

      <div className="p-4 max-w-6xl mx-auto space-y-4">
        {/* Navigation Tabs */}
        <div className="flex bg-gray-200/70 p-1 rounded-xl max-w-md">
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'studio'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <LayoutGrid size={15} />
            Timetable Studio
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('legacy')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'legacy'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <ListFilter size={15} />
            Weekly Slots (Legacy)
          </button>
        </div>

        {activeTab === 'studio' ? (
          <TimetableStudioView />
        ) : (
          <div className="space-y-4 max-w-2xl">
            {/* Add Slot Card */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-gray-900 text-sm">Schedule Class Slot</h3>

          <Select
            label="Teaching Assignment"
            placeholder="Select subject & professor..."
            value={assignmentId}
            onChange={e => setAssignmentId(e.target.value)}
            options={assignments?.map(a => {
              const subj = (a.subjects as any)?.name
              const prof = (a.professors as any)?.profiles?.name
              const cls = (a.classes as any)?.name
              const batch = (a.batches as any)?.name
              return {
                value: a.id,
                label: `${subj} (${cls}${batch ? ` · ${batch}` : ''}) — Prof. ${prof}`,
              }
            }) ?? []}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Day of Week"
              value={weekday}
              onChange={e => setWeekday(e.target.value)}
              options={WEEKDAY_FULL.map((d, i) => ({ value: i, label: d }))}
            />
            <Input
              label="Start Time"
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
            />
            <Input
              label="End Time"
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
            />
          </div>

          <Input
            label="Room / Hall (optional)"
            placeholder="e.g. Lab 3 / Room 204"
            value={room}
            onChange={e => setRoom(e.target.value)}
          />

          <Button
            className="w-full"
            loading={addSlotMutation.isPending}
            onClick={() => addSlotMutation.mutate()}
          >
            Add Timetable Slot
          </Button>
        </div>

        {/* Timetable View */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
        ) : isSlotsError ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle size={20} className="text-red-500 shrink-0" />
              <p className="font-semibold text-sm">Failed to load timetable slots</p>
            </div>
            <div className="bg-white/90 rounded-xl p-3 border border-red-100 space-y-1.5 text-left text-xs">
              <div>
                <span className="font-semibold text-gray-700">Failed Operation: </span>
                <span className="font-medium text-red-700">Loading all timetable slots (admin query)</span>
              </div>
              {(slotsError as any)?.code && (
                <div>
                  <span className="font-semibold text-gray-700">PostgreSQL / API Code: </span>
                  <span className="font-mono text-gray-900 bg-gray-100 px-1 py-0.5 rounded">
                    {(slotsError as any).code}
                  </span>
                </div>
              )}
              <div>
                <span className="font-semibold text-gray-700">Message: </span>
                <span className="text-red-600">{(slotsError as any)?.message || 'Database query error'}</span>
              </div>
              {(slotsError as any)?.details && (
                <div>
                  <span className="font-semibold text-gray-700">Details: </span>
                  <span className="text-gray-600 font-mono text-[11px]">{(slotsError as any).details}</span>
                </div>
              )}
              {(slotsError as any)?.hint && (
                <div>
                  <span className="font-semibold text-gray-700">Hint: </span>
                  <span className="text-gray-600 font-mono text-[11px]">{(slotsError as any).hint}</span>
                </div>
              )}
            </div>
            <div className="text-center pt-1">
              <Button size="sm" variant="outline" onClick={() => refetchSlots()}>
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </div>
          </div>
        ) : Object.keys(slotsByDay).length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">No timetable slots created yet</p>
        ) : (
          <div className="space-y-4">
            {Object.keys(slotsByDay).map(Number).map(day => (
              <div key={day} className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  {WEEKDAY_FULL[day]}
                </h4>

                <div className="space-y-2">
                  {slotsByDay[day]?.map(slot => {
                    const ta = slot.teaching_assignments as any
                    const subj = ta?.subjects?.name
                    const prof = ta?.professors?.profiles?.name
                    const cls = ta?.classes?.name
                    const batch = ta?.batches?.name

                    return (
                      <div
                        key={slot.id}
                        className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between shadow-2xs hover:border-gray-300 transition-colors"
                      >
                        <div>
                          <p className="font-medium text-gray-900 text-sm">
                            {subj} <span className="text-gray-500 text-xs">({cls}{batch ? ` · ${batch}` : ''})</span>
                          </p>
                          <p className="text-xs text-blue-600 font-medium">Prof. {prof}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                            {slot.room ? ` · Room ${slot.room}` : ''}
                          </p>
                        </div>

                        <button
                          type="button"
                          className="text-gray-400 hover:text-red-600 p-2 rounded-lg transition-colors"
                          title="Delete slot"
                          onClick={() => {
                            if (window.confirm('Delete this timetable slot?')) {
                              deleteSlotMutation.mutate(slot.id)
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
          </div>
        )}
      </div>
    </div>
  )
}
