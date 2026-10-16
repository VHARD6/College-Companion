import { NavLink } from 'react-router-dom'
import { Home, BookOpen, Calendar, BarChart2, Users, Settings } from 'lucide-react'
import type { Role } from '../../types'

interface NavItem {
  to: string
  icon: React.ReactNode
  label: string
}

const studentNav: NavItem[] = [
  { to: '/student',           icon: <Home size={22} />,     label: 'Home' },
  { to: '/student/attendance',icon: <BookOpen size={22} />, label: 'Attendance' },
  { to: '/student/timetable', icon: <Calendar size={22} />, label: 'Timetable' },
]

const professorNav: NavItem[] = [
  { to: '/professor',         icon: <Home size={22} />,      label: 'Home' },
  { to: '/professor/reports', icon: <BarChart2 size={22} />, label: 'Reports' },
]

const adminNav: NavItem[] = [
  { to: '/admin',             icon: <Home size={22} />,      label: 'Dashboard' },
  { to: '/admin/users',       icon: <Users size={22} />,     label: 'Users' },
  { to: '/admin/structure',   icon: <BookOpen size={22} />,  label: 'Structure' },
  { to: '/admin/settings',    icon: <Settings size={22} />,  label: 'Settings' },
]

const navByRole: Record<Role, NavItem[]> = {
  student:   studentNav,
  professor: professorNav,
  admin:     adminNav,
}

export default function BottomNav({ role }: { role: Role }) {
  const items = navByRole[role]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-10">
      {items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to.split('/').length <= 2}  // only exact match on root paths
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs gap-0.5 transition-colors
             ${isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`
          }
        >
          {item.icon}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
