import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'

// ─── Auth ────────────────────────────────────────────────────────────────────
import LoginPage from './pages/auth/LoginPage'
import UnauthorizedPage from './pages/auth/UnauthorizedPage'
import ProtectedRoute from './components/ui/ProtectedRoute'

// ─── Student ─────────────────────────────────────────────────────────────────
import StudentLayout from './pages/student/StudentLayout'
import StudentHome from './pages/student/StudentHome'
import AttendanceOverviewPage from './pages/student/AttendanceOverviewPage'
import SubjectDetailPage from './pages/student/SubjectDetailPage'
import TimetablePage from './pages/student/TimetablePage'

// ─── Professor ───────────────────────────────────────────────────────────────
import ProfessorLayout from './pages/professor/ProfessorLayout'
import ProfessorHome from './pages/professor/ProfessorHome'
import MarkAttendancePage from './pages/professor/MarkAttendancePage'
import ProfessorReportsPage from './pages/professor/ProfessorReportsPage'

// ─── Admin ───────────────────────────────────────────────────────────────────
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AdminStructurePage from './pages/admin/AdminStructurePage'
import AdminSettingsPage from './pages/admin/AdminSettingsPage'
import TeachingAssignmentsPage from './pages/admin/TeachingAssignmentsPage'
import TimetableAdminPage from './pages/admin/TimetablePage'
import ReportsPage from './pages/admin/ReportsPage'

import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'

// Create a shared QueryClient — staleTime 30s keeps data fresh without over-fetching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/**
 * Handles Android hardware back button and status bar in native runtime
 */
function NativeMobileHandler() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    // Configure status bar
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    StatusBar.setBackgroundColor({ color: '#2563eb' }).catch(() => {})

    // Hide splash screen once React has mounted
    SplashScreen.hide().catch(() => {})

    // Android hardware back button listener
    const backListener = CapApp.addListener('backButton', () => {
      const currentPath = window.location.pathname
      // Exit app if on root dashboard or login page
      if (
        currentPath === '/login' ||
        currentPath === '/student' ||
        currentPath === '/professor' ||
        currentPath === '/admin' ||
        currentPath === '/'
      ) {
        CapApp.exitApp()
      } else {
        navigate(-1)
      }
    })

    return () => {
      backListener.then(handle => handle.remove()).catch(() => {})
    }
  }, [navigate, location])

  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NativeMobileHandler />
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Student routes */}
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<StudentHome />} />
            <Route path="attendance" element={<AttendanceOverviewPage />} />
            <Route path="subject/:subjectId" element={<SubjectDetailPage />} />
            <Route path="timetable" element={<TimetablePage />} />
          </Route>

          {/* Professor routes */}
          <Route
            path="/professor"
            element={
              <ProtectedRoute allowedRoles={['professor']}>
                <ProfessorLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ProfessorHome />} />
            <Route path="mark" element={<MarkAttendancePage />} />
            <Route path="reports" element={<ProfessorReportsPage />} />
          </Route>

          {/* Admin routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="structure" element={<AdminStructurePage />} />
            <Route path="assignments" element={<TeachingAssignmentsPage />} />
            <Route path="timetable" element={<TimetableAdminPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>

          {/* Catch-all: redirect to login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>

      {/* Global toast notifications */}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: { borderRadius: '12px', fontSize: '14px' },
        }}
      />
    </QueryClientProvider>
  )
}
