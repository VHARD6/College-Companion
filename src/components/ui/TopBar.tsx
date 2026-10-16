import { ArrowLeft, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface Props {
  title: string
  showBack?: boolean
  showLogout?: boolean
}

export default function TopBar({ title, showBack = false, showLogout = false }: Props) {
  const navigate = useNavigate()
  const { signOut, profile } = useAuth()

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
      {showBack && (
        <button onClick={() => navigate(-1)} className="p-1 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className="flex-1 text-lg font-semibold text-gray-900 truncate">{title}</h1>
      {showLogout && profile && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 hidden sm:block">{profile.name}</span>
          <button
            onClick={signOut}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      )}
    </header>
  )
}
