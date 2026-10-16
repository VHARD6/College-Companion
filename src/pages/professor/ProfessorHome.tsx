import { useAuth } from '../../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import { useNavigate } from 'react-router-dom'
import { todayISO, todayWeekday, formatTime } from '../../lib/utils'
import { BookOpen } from 'lucide-react'

export default function ProfessorHome() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Fetch the professor row
  const { data: professor } = useQuery({
    queryKey: ['my-professor', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase.from('professors').select('*').eq('user_id', profile!.id).single()
      return data
    },
  })

  // Fetch today's timetable slots for this professor's teaching assignments
  const { data: todaySlots, isLoading } = useQuery({
    queryKey: ['professor-today', professor?.id],
    enabled: !!professor,
    queryFn: async () => {
      const weekday = todayWeekday()

      // Get all assignment IDs for this professor
      const { data: assignments } = await supabase
        .from('teaching_assignments')
        .select('id, subjects(name, code, type), classes(name)')
        .eq('professor_id', professor!.id)

      if (!assignments) return []

      const assignmentIds = assignments.map(a => a.id)

      // Get today's slots
      const { data: slots } = await supabase
        .from('timetable_slots')
        .select('*')
        .in('teaching_assignment_id', assignmentIds)
        .eq('weekday', weekday)
        .order('start_time')

      if (!slots) return []

      // Check if a session was already created today for each slot
      const today = todayISO()
      const { data: existingSessions } = await supabase
        .from('sessions')
        .select('id, teaching_assignment_id, status')
        .in('teaching_assignment_id', assignmentIds)
        .eq('date', today)

      const sessionMap = new Map(existingSessions?.map(s => [s.teaching_assignment_id, s]) ?? [])
      const assignmentMap = new Map(assignments.map(a => [a.id, a]))

      return slots.map(slot => ({
        ...slot,
        assignment: assignmentMap.get(slot.teaching_assignment_id),
        session: sessionMap.get(slot.teaching_assignment_id) ?? null,
      }))
    },
  })

  return (
    <div>
      <TopBar title="Professor Dashboard" showLogout />
      <div className="p-4 space-y-4">

        {/* Greeting */}
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl p-5 text-white">
          <p className="text-sm opacity-80">Good morning,</p>
          <p className="text-xl font-bold">{profile?.name}</p>
        </div>

        {/* Today's classes */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Today's Classes</h2>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-8 w-8" />
            </div>
          ) : todaySlots?.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-400">
              <BookOpen size={32} className="mb-2" />
              <p>No classes scheduled today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todaySlots?.map(slot => {
                const subject = (slot.assignment as any)?.subjects
                const cls = (slot.assignment as any)?.classes
                const session = slot.session as any
                const hasSession = !!session

                return (
                  <Card
                    key={slot.id}
                    onClick={() => {
                      if (hasSession) {
                        navigate(`/professor/mark?sessionId=${session.id}`)
                      } else {
                        navigate(`/professor/mark?assignmentId=${slot.teaching_assignment_id}`)
                      }
                    }}
                    className="hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{subject?.name}</p>
                        <p className="text-xs text-gray-500">{cls?.name} · {formatTime(slot.start_time)} – {formatTime(slot.end_time)}</p>
                        {slot.room && <p className="text-xs text-gray-400">{slot.room}</p>}
                      </div>
                      <div className="text-right">
                        {hasSession ? (
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            session.status === 'submitted' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {session.status === 'submitted' ? 'Submitted' : 'Draft'}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                            Mark Now
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* All assignments quick list */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">All Subjects</h2>
          <AllAssignments professorId={professor?.id} />
        </div>
      </div>
    </div>
  )
}

/** Shows all teaching assignments with a link to mark attendance */
function AllAssignments({ professorId }: { professorId?: number }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['professor-assignments', professorId],
    enabled: !!professorId,
    queryFn: async () => {
      const { data } = await supabase
        .from('teaching_assignments')
        .select('id, subjects(name, code, type), classes(name, semester), batches(name)')
        .eq('professor_id', professorId!)
      return data ?? []
    },
  })

  if (isLoading) return <Spinner className="h-6 w-6 mx-auto" />

  return (
    <div className="space-y-2">
      {data?.map(a => {
        const subject = (a as any).subjects
        const cls = (a as any).classes
        const batch = (a as any).batches
        return (
          <Card key={a.id} onClick={() => navigate(`/professor/mark?assignmentId=${a.id}`)} className="hover:shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm text-gray-900">{subject?.name}</p>
                <p className="text-xs text-gray-500">
                  {cls?.name} · Sem {cls?.semester}
                  {batch ? ` · ${batch.name}` : ''}
                </p>
              </div>
              <span className="text-xs text-blue-600">Mark →</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
