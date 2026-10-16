import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { formatDate } from '../../lib/utils'
import { History, FileText, AlertCircle, RefreshCw } from 'lucide-react'

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'sessions' | 'audit'>('sessions')

  // Recent submitted sessions
  const {
    data: sessions,
    isLoading: sessionsLoading,
    isError: isSessionsError,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ['admin-submitted-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          id,
          date,
          session_type,
          submitted_at,
          submitted_by,
          profiles!sessions_submitted_by_fkey(name),
          teaching_assignments(
            subjects(name, code),
            classes(name),
            batches(name)
          )
        `)
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data ?? []
    },
  })

  // Audit logs query
  const {
    data: auditLogs,
    isLoading: auditLoading,
    isError: isAuditError,
    error: auditError,
    refetch: refetchAudit,
  } = useQuery({
    queryKey: ['admin-audit-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_audit_log')
        .select(`
          id,
          old_status,
          new_status,
          reason,
          changed_at,
          profiles!attendance_audit_log_changed_by_fkey(name),
          attendance_records(
            session_id,
            students(
              roll_no,
              profiles(name)
            ),
            sessions(
              date,
              teaching_assignments(
                subjects(name, code),
                classes(name)
              )
            )
          )
        `)
        .order('changed_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <TopBar title="Reports & Audit Log" showBack />

      {/* Tab Switcher */}
      <div className="flex bg-white border-b border-gray-200 sticky top-[53px] z-10">
        <button
          type="button"
          className={`flex-1 py-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'sessions'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('sessions')}
        >
          <FileText size={16} />
          <span>Recent Sessions</span>
        </button>

        <button
          type="button"
          className={`flex-1 py-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'audit'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('audit')}
        >
          <History size={16} />
          <span>Audit Log</span>
        </button>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* SESSIONS TAB */}
        {activeTab === 'sessions' && (
          <div>
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide mb-3">
              Submitted Attendance Sessions ({sessions?.length ?? 0})
            </h3>

            {sessionsLoading ? (
              <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
            ) : isSessionsError ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2">
                <AlertCircle size={24} className="text-red-500 mx-auto" />
                <p className="font-semibold text-red-900 text-sm">Failed to load recent sessions</p>
                <p className="text-xs text-red-600">{(sessionsError as any)?.message || 'Database query error'}</p>
                <Button size="sm" variant="outline" onClick={() => refetchSessions()}>
                  <RefreshCw size={14} className="mr-1.5" />
                  Retry
                </Button>
              </div>
            ) : sessions?.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No submitted sessions yet</p>
            ) : (
              <div className="space-y-2">
                {sessions?.map(s => {
                  const ta = s.teaching_assignments as any
                  const subj = ta?.subjects
                  const cls = ta?.classes
                  const batch = ta?.batches
                  const submitter = (s as any).profiles?.name ?? 'Professor'

                  return (
                    <div
                      key={s.id}
                      className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-2xs hover:border-gray-300 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-900 text-sm">
                            {subj?.name} <span className="text-gray-400 font-mono text-xs">({subj?.code})</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {cls?.name}{batch ? ` (${batch.name})` : ''} · {formatDate(s.date)} · <span className="capitalize">{s.session_type}</span>
                          </p>
                          <p className="text-xs text-gray-400 mt-1">Submitted by {submitter}</p>
                        </div>
                        <Badge variant="green">Submitted</Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* AUDIT LOG TAB */}
        {activeTab === 'audit' && (
          <div>
            <div className="mb-3">
              <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">
                Attendance Audit Log
              </h3>
              <p className="text-xs text-gray-500">
                Immutable trail of all attendance modifications after submission.
              </p>
            </div>

            {auditLoading ? (
              <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
            ) : isAuditError ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2">
                <AlertCircle size={24} className="text-red-500 mx-auto" />
                <p className="font-semibold text-red-900 text-sm">Failed to load audit logs</p>
                <p className="text-xs text-red-600">{(auditError as any)?.message || 'Database query error'}</p>
                <Button size="sm" variant="outline" onClick={() => refetchAudit()}>
                  <RefreshCw size={14} className="mr-1.5" />
                  Retry
                </Button>
              </div>
            ) : auditLogs?.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No audit logs recorded yet</p>
            ) : (
              <div className="space-y-2">
                {auditLogs?.map(log => {
                  const changer = (log as any).profiles?.name ?? 'Admin / Prof'
                  const rec = (log as any).attendance_records
                  const student = rec?.students
                  const studentName = student?.profiles?.name ?? 'Student'
                  const rollNo = student?.roll_no ?? ''
                  const session = rec?.sessions
                  const ta = session?.teaching_assignments

                  return (
                    <div
                      key={log.id}
                      className="bg-white rounded-xl border border-gray-200 p-3 shadow-2xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-900">
                          {studentName} ({rollNo})
                        </span>
                        <span className="text-[11px] text-gray-400">
                          {new Date(log.changed_at).toLocaleString('en-IN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="text-xs text-gray-600 flex items-center gap-1.5">
                        <span>Status changed:</span>
                        <Badge variant={log.old_status === 'absent' ? 'red' : log.old_status === 'present' ? 'green' : 'gray'}>
                          {log.old_status ?? 'initial'}
                        </Badge>
                        <span>→</span>
                        <Badge variant={log.new_status === 'present' ? 'green' : 'red'}>
                          {log.new_status}
                        </Badge>
                        <span className="text-gray-400">by {changer}</span>
                      </div>

                      {ta?.subjects?.name && (
                        <p className="text-[11px] text-gray-400">
                          {ta.subjects.name} ({ta.classes?.name})
                        </p>
                      )}

                      <div className="bg-amber-50/70 border border-amber-200/60 rounded-lg px-2.5 py-1 text-xs text-amber-900 mt-1">
                        <span className="font-medium">Reason: </span>
                        {log.reason}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
