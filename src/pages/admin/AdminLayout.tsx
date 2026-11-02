import { Outlet } from 'react-router-dom'
import BottomNav from '../../components/ui/BottomNav'

export default function AdminLayout() {
  return (
    <div
      className="min-h-screen bg-gray-50 pb-16"
      style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <Outlet />
      <BottomNav role="admin" />
    </div>
  )
}
