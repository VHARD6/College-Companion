import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'

// ─── Auth ────────────────────────────────────────────────────────────────────
import LoginPage from './pages/auth/LoginPage'
import UnauthorizedPage from './pages/auth/UnauthorizedPage'
import PrivacyPolicyPage from './pages/public/PrivacyPolicyPage'
import ProtectedRoute from './components/ui/ProtectedRoute'

// ─── Student (Lazy Loaded) ───────────────────────────────────────────────────
const StudentLayout = lazy(() => import('./pages/student/StudentLayout'))
const StudentHome = lazy(() => import('./pages/student/StudentHome'))
const AttendanceOverviewPage = lazy(() => import('./pages/student/AttendanceOverviewPage'))
const SubjectDetailPage = lazy(() => import('./pages/student/SubjectDetailPage'))
const TimetablePage = lazy(() => import('./pages/student/TimetablePage'))

// ─── Professor (Lazy Loaded) ─────────────────────────────────────────────────
const ProfessorLayout = lazy(() => import('./pages/professor/ProfessorLayout'))
const ProfessorHome = lazy(() => import('./pages/professor/ProfessorHome'))
const MarkAttendancePage = lazy(() => import('./pages/professor/MarkAttendancePage'))
const ProfessorReportsPage = lazy(() => import('./pages/professor/ProfessorReportsPage'))

// ─── Admin (Lazy Loaded) ─────────────────────────────────────────────────────
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'))
const AdminStructurePage = lazy(() => import('./pages/admin/AdminStructurePage'))
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage'))
const TeachingAssignmentsPage = lazy(() => import('./pages/admin/TeachingAssignmentsPage'))
const TimetableAdminPage = lazy(() => import('./pages/admin/TimetablePage'))
const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'))

import { useEffect, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'

// Shared QueryClient singleton — also used by useAuth for cache cleanup on sign-out
import { queryClient } from './lib/queryClient'
import { dispatchHardwareBack } from './lib/backButtonHandler'

/**
 * Lightweight loading indicator for lazy-loaded route chunks
 */
function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
    </div>
  )
}

/**
 * Handles Android hardware back button and status bar in native runtime
 */
function NativeMobileHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    // Configure status bar
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    StatusBar.setBackgroundColor({ color: '#2563eb' }).catch(() => {})

    // Hide splash screen once React has mounted
    SplashScreen.hide().catch(() => {})

    // Android hardware back button listener
    const backListener = CapApp.addListener('backButton', () => {
      // Allow custom handlers (dialog dismissal, wizard steps, unsaved changes guards) to intercept
      if (dispatchHardwareBack()) {
        return
      }

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
  }, [navigate])

  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NativeMobileHandler />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />

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
        </Suspense>
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
