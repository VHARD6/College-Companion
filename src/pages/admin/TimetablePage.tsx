import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import { WEEKDAY_FULL, formatTime } from '../../lib/utils'
import { Trash2 } from 'lucide-react'

export default function TimetablePage() {
  const queryClient = useQueryClient()
  const [assignmentId, setAssignmentId] = useState('')
  const [weekday, setWeekday] = useState('0')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [room, setRoom] = useState('')

  // Fetch teaching assignments
  const { data: assignments } = useQuery({
    queryKey: ['assignments-for-timetable'],
    queryFn: async () => {
      const { data } = await supabase
        .from('teaching_assignments')
        .select(`
          id,
          professors(profiles(name)),
          subjects(name, code),
          classes(name),
          batches(name)
        `)
      return data ?? []
    },
  })

  // Fetch all timetable slots
  const { data: slots, isLoading } = useQuery({
    queryKey: ['all-timetable-slots'],
    queryFn: async () => {
      const { data } = await supabase
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

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
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
    </div>
  )
}
