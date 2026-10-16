import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Card from '../../components/ui/Card'
import { Users, BookOpen, GraduationCap, BarChart2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Spinner from '../../components/ui/Spinner'

export default function AdminDashboard() {
  const navigate = useNavigate()

  // Fetch key counts for the stats overview
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [
        { count: studentCount },
        { count: professorCount },
        { count: classCount },
        { count: sessionCount },
      ] = await Promise.all([
        supabase.from('students').select('id', { count: 'exact', head: true }),
        supabase.from('professors').select('id', { count: 'exact', head: true }),
        supabase.from('classes').select('id', { count: 'exact', head: true }),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      ])

      return {
        students: studentCount ?? 0,
        professors: professorCount ?? 0,
        classes: classCount ?? 0,
        sessions: sessionCount ?? 0,
      }
    },
  })

  const statCards = [
    { label: 'Students', value: stats?.students, icon: <GraduationCap size={20} className="text-blue-600" />, bg: 'bg-blue-50' },
    { label: 'Professors', value: stats?.professors, icon: <Users size={20} className="text-indigo-600" />, bg: 'bg-indigo-50' },
    { label: 'Classes', value: stats?.classes, icon: <BookOpen size={20} className="text-green-600" />, bg: 'bg-green-50' },
    { label: 'Sessions', value: stats?.sessions, icon: <BarChart2 size={20} className="text-amber-600" />, bg: 'bg-amber-50' },
  ]

  return (
    <div>
      <TopBar title="Admin Dashboard" showLogout />
      <div className="p-4 space-y-4">

        {/* Stats grid */}
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner className="h-8 w-8" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {statCards.map(s => (
              <div key={s.label} className={`${s.bg} rounded-2xl p-4`}>
                <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs font-medium text-gray-600">{s.label}</span></div>
                <p className="text-3xl font-black text-gray-900">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Quick nav */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Manage</h2>
          <Card onClick={() => navigate('/admin/users')} className="hover:shadow-md">
            <div className="flex items-center gap-3">
              <Users size={20} className="text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Users</p>
                <p className="text-xs text-gray-500">Manage students, professors and admins (CSV import)</p>
              </div>
            </div>
          </Card>
          <Card onClick={() => navigate('/admin/structure')} className="hover:shadow-md">
            <div className="flex items-center gap-3">
              <BookOpen size={20} className="text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Academic Structure</p>
                <p className="text-xs text-gray-500">Departments, classes, subjects, batches</p>
              </div>
            </div>
          </Card>
          <Card onClick={() => navigate('/admin/assignments')} className="hover:shadow-md">
            <div className="flex items-center gap-3">
              <GraduationCap size={20} className="text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Teaching Assignments</p>
                <p className="text-xs text-gray-500">Map professors to classes and subjects</p>
              </div>
            </div>
          </Card>
          <Card onClick={() => navigate('/admin/timetable')} className="hover:shadow-md">
            <div className="flex items-center gap-3">
              <BookOpen size={20} className="text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Timetable Schedule</p>
                <p className="text-xs text-gray-500">Configure weekly lecture and practical slots</p>
              </div>
            </div>
          </Card>
          <Card onClick={() => navigate('/admin/reports')} className="hover:shadow-md">
            <div className="flex items-center gap-3">
              <BarChart2 size={20} className="text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Reports & Audit Log</p>
                <p className="text-xs text-gray-500">Review sessions and attendance change history</p>
              </div>
            </div>
          </Card>
          <Card onClick={() => navigate('/admin/settings')} className="hover:shadow-md">
            <div className="flex items-center gap-3">
              <BarChart2 size={20} className="text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">Settings & Policy</p>
                <p className="text-xs text-gray-500">Attendance policy &amp; correction window</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
