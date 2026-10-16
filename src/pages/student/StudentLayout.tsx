import { Outlet } from 'react-router-dom'
import BottomNav from '../../components/ui/BottomNav'

export default function StudentLayout() {
  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* pb-16 leaves room for the fixed bottom nav */}
      <Outlet />
      <BottomNav role="student" />
    </div>
  )
}
