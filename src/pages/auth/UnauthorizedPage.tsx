import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Button from '../../components/ui/Button'
import { ShieldAlert, ArrowLeft, LogOut, LayoutDashboard } from 'lucide-react'

export default function UnauthorizedPage() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()

  const destination = profile
    ? {
        student: { path: '/student', label: 'Go to Student Dashboard' },
        professor: { path: '/professor', label: 'Go to Faculty Dashboard' },
        admin: { path: '/admin', label: 'Go to Admin Dashboard' },
      }[profile.role]
    : null

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center">
      <div className="max-w-md w-full bg-white rounded-3xl border border-gray-200 p-8 shadow-xl space-y-4">
        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldAlert size={36} />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Access Restricted</h1>
          <p className="text-sm text-gray-500 mt-1">
            You do not have permission to view this section with your current account privileges.
          </p>
        </div>

        {profile && (
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 text-xs text-gray-600">
            Signed in as <span className="font-semibold text-gray-900">{profile.name}</span> ({profile.role})
          </div>
        )}

        <div className="space-y-2 pt-2">
          {destination && (
            <Button
              className="w-full"
              size="lg"
              onClick={() => navigate(destination.path, { replace: true })}
            >
              <LayoutDashboard size={18} className="mr-2" />
              {destination.label}
            </Button>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={16} className="mr-2" />
            Go Back
          </Button>

          <Button
            variant="ghost"
            className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={signOut}
          >
            <LogOut size={16} className="mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  )
}
