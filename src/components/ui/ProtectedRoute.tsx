import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import type { Role } from '../../types'

interface Props {
  children: React.ReactNode
  allowedRoles?: Role[]
}

/**
 * Wraps a route and redirects to /login if not authenticated,
 * or to /unauthorized if the user's role is not in allowedRoles.
 */
export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!profile || !profile.is_active) return <Navigate to="/login" replace />

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return <>{children}</>
}
