import { Outlet } from 'react-router-dom'
import BottomNav from '../../components/ui/BottomNav'

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <Outlet />
      <BottomNav role="admin" />
    </div>
  )
}
