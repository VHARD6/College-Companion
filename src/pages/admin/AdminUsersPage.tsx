import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import { UserPlus, FileSpreadsheet, Search, Edit3, AlertCircle, RefreshCw, Layers } from 'lucide-react'
import type { Role } from '../../types'

import { extractSingleRelation } from '../../lib/adminUtils'
import PaginationControls from '../../components/ui/PaginationControls'
import { calcPageRange, calcTotalPages } from '../../lib/pagination'
import CsvImportCard from '../../components/admin/CsvImportCard'
import UserEnrollmentModal from '../../components/admin/UserEnrollmentModal'
import BulkClassAssignModal from '../../components/admin/BulkClassAssignModal'
import AddUserCard from '../../components/admin/AddUserCard'

export default function AdminUsersPage() {
  const queryClient = useQueryClient()
  const [showAddForm, setShowAddForm] = useState(false)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')
  const [branchFilter, setBranchFilter] = useState<'all' | string>('all')
  const [semesterFilter, setSemesterFilter] = useState<'all' | string>('all')
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([])
  const [showBulkAssign, setShowBulkAssign] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 25

  // Enrollment / Assignment modal state
  const [editingUser, setEditingUser] = useState<any | null>(null)

  // Fetch user profiles with attached student & professor records using server-side range pagination
  const {
    data: usersData,
    isLoading: isUsersLoading,
    isError: isUsersError,
    error: usersError,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['admin-users', roleFilter, branchFilter, semesterFilter, page, search.trim()],
    queryFn: async () => {
      const { from, to } = calcPageRange(page, pageSize)
      const trimmedSearch = search.trim()

      let studentFilterUserIds: string[] | null = null

      if (branchFilter !== 'all' || semesterFilter !== 'all') {
        if (roleFilter === 'professor') {
          if (branchFilter !== 'all') {
            const { data: profMatches, error: profErr } = await supabase
              .from('professors')
              .select('user_id')
              .eq('department_id', Number(branchFilter))
            if (profErr) throw profErr
            studentFilterUserIds = (profMatches ?? []).map(p => p.user_id)
          }
        } else {
          let studentQuery = supabase
            .from('students')
            .select('user_id, classes!inner(department_id, semester)')

          if (branchFilter !== 'all') {
            studentQuery = studentQuery.eq('classes.department_id', Number(branchFilter))
          }
          if (semesterFilter !== 'all') {
            studentQuery = studentQuery.eq('classes.semester', Number(semesterFilter))
          }

          const { data: filterMatches, error: filterErr } = await studentQuery
          if (filterErr) throw filterErr
          studentFilterUserIds = (filterMatches ?? []).map(s => s.user_id)
        }

        if (studentFilterUserIds !== null && studentFilterUserIds.length === 0) {
          return { items: [], totalCount: 0 }
        }
      }

      let matchingUserIds: string[] = []
      if (trimmedSearch) {
        // If search looks like it could match roll number, find matching student records
        const { data: studentMatches } = await supabase
          .from('students')
          .select('user_id')
          .ilike('roll_no', `%${trimmedSearch}%`)
          .limit(100)

        if (studentMatches && studentMatches.length > 0) {
          matchingUserIds = studentMatches.map(s => s.user_id)
        }
      }

      let query = supabase
        .from('profiles')
        .select(`
          *,
          students(
            id,
            roll_no,
            class_id,
            batch_id,
            classes(
              id,
              name,
              semester,
              department_id,
              departments(id, name)
            ),
            batches(id, name)
          ),
          professors(
            id,
            department_id,
            departments(id, name)
          )
        `, { count: 'exact' })

      if (roleFilter !== 'all') {
        query = query.eq('role', roleFilter)
      }

      if (studentFilterUserIds !== null) {
        query = query.in('id', studentFilterUserIds)
      }

      if (trimmedSearch) {
        if (matchingUserIds.length > 0) {
          query = query.or(`name.ilike.%${trimmedSearch}%,id.in.(${matchingUserIds.join(',')})`)
        } else {
          query = query.ilike('name', `%${trimmedSearch}%`)
        }
      }

      query = query.order('created_at', { ascending: false }).range(from, to)

      const { data, count, error } = await query
      if (error) throw error
      return {
        items: data ?? [],
        totalCount: count ?? 0,
      }
    },
  })

  // Fetch departments, classes, batches for dropdowns
  const { data: departments } = useQuery({
    queryKey: ['departments-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('departments').select('*').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: classes } = useQuery({
    queryKey: ['classes-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, departments(id, name)').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Open enrollment / assignment modal
  const handleOpenEdit = (user: any) => {
    setEditingUser(user)
  }

  // Toggle user active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, is_active }: { userId: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !is_active })
        .eq('id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('User status updated')
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Paginated user list
  const users = usersData?.items ?? []
  const totalUsersCount = usersData?.totalCount ?? 0
  const filteredUsers = users

  const roleBadge: Record<string, 'blue' | 'green' | 'gray'> = {
    admin: 'blue',
    professor: 'green',
    student: 'gray',
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <TopBar title="User Management" showBack />

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => {
              setShowAddForm(!showAddForm)
              setShowCsvImport(false)
            }}
          >
            <UserPlus size={16} className="mr-1.5" />
            {showAddForm ? 'Cancel' : 'Add User'}
          </Button>

          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              setShowCsvImport(!showCsvImport)
              setShowAddForm(false)
            }}
          >
            <FileSpreadsheet size={16} className="mr-1.5" />
            {showCsvImport ? 'Cancel' : 'CSV Import'}
          </Button>
        </div>

        {/* Add User Card */}
        <AddUserCard
          isOpen={showAddForm}
          departments={departments}
          classes={classes}
          onSuccess={() => {
            setShowAddForm(false)
            refetchUsers()
          }}
          onClose={() => setShowAddForm(false)}
        />

        {/* CSV Import Card */}
        <CsvImportCard
          isOpen={showCsvImport}
          classes={classes}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] })
            queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
          }}
          onClose={() => setShowCsvImport(false)}
        />

        {/* Edit Enrollment / Department Modal */}
        <UserEnrollmentModal
          user={editingUser}
          departments={departments}
          classes={classes}
          onClose={() => setEditingUser(null)}
          onSuccess={() => refetchUsers()}
        />

        {/* Search & Role Filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search by name or roll no..."
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {(['all', 'student', 'professor', 'admin'] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  className={`px-3 py-1 text-xs rounded-full capitalize font-medium transition-colors ${
                    roleFilter === r
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                  onClick={() => {
                    setRoleFilter(r)
                    setPage(1)
                  }}
                >
                  {r === 'all' ? 'All Roles' : `${r}s`}
                </button>
              ))}
            </div>

            {totalUsersCount > 0 && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium shrink-0">
                Total: {totalUsersCount}
              </span>
            )}
          </div>

          {/* Academic Branch & Semester Dropdown Filters */}
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <select
              aria-label="Filter by branch"
              className="w-full text-xs rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={branchFilter}
              onChange={e => {
                setBranchFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All Branches</option>
              {departments?.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by semester"
              className="w-full text-xs rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={semesterFilter}
              onChange={e => {
                setSemesterFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All Semesters</option>
              <option value="1">Semester 1</option>
              <option value="2">Semester 2</option>
              <option value="3">Semester 3</option>
              <option value="4">Semester 4</option>
              <option value="5">Semester 5</option>
              <option value="6">Semester 6</option>
              <option value="7">Semester 7</option>
              <option value="8">Semester 8</option>
            </select>
          </div>
        </div>

        {/* Users List */}
        {isUsersLoading ? (
          <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
        ) : isUsersError ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2">
            <AlertCircle size={24} className="text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-red-900">Failed to load user accounts</p>
            <p className="text-xs text-red-600">{(usersError as any)?.message || 'Database query error'}</p>
            <Button size="sm" variant="outline" onClick={() => refetchUsers()}>
              <RefreshCw size={14} className="mr-1.5" />
              Retry
            </Button>
          </div>
        ) : filteredUsers?.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">No users found</p>
        ) : (
          <div className="space-y-2.5">
            {/* Multi-student selection header */}
            {(() => {
              const pageStudentIds = filteredUsers
                .map(u => extractSingleRelation(u.students)?.id)
                .filter((id): id is number => typeof id === 'number')

              const allPageSelected =
                pageStudentIds.length > 0 &&
                pageStudentIds.every(id => selectedStudentIds.includes(id))

              const toggleSelectAllPage = () => {
                if (allPageSelected) {
                  setSelectedStudentIds(prev => prev.filter(id => !pageStudentIds.includes(id)))
                } else {
                  setSelectedStudentIds(prev => Array.from(new Set([...prev, ...pageStudentIds])))
                }
              }

              if (pageStudentIds.length === 0) return null

              return (
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100/80 rounded-xl text-xs text-gray-700">
                  <label className="flex items-center gap-2 cursor-pointer font-medium select-none">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAllPage}
                      className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                    />
                    <span>Select all students on this page ({pageStudentIds.length})</span>
                  </label>
                  {selectedStudentIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedStudentIds([])}
                      className="text-gray-500 hover:text-gray-900 underline text-[11px]"
                    >
                      Clear all ({selectedStudentIds.length})
                    </button>
                  )}
                </div>
              )
            })()}

            {filteredUsers?.map(user => {
              const studentRec = extractSingleRelation(user.students)
              const profRec = extractSingleRelation(user.professors)

              const isStudent = user.role === 'student' && studentRec
              const isSelected = isStudent && selectedStudentIds.includes(studentRec.id)

              const toggleSelectStudent = (id: number) => {
                setSelectedStudentIds(prev =>
                  prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                )
              }

              const isStudentEnrolled = studentRec && studentRec.class_id
              const isProfAssigned = profRec && profRec.department_id

              return (
                <div
                  key={user.id}
                  className={`bg-white rounded-2xl border p-3.5 shadow-2xs space-y-2 transition-colors ${
                    isSelected ? 'border-blue-500 bg-blue-50/20' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {isStudent && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectStudent(studentRec.id)}
                        className="mt-1 rounded text-blue-600 focus:ring-blue-500 h-4 w-4 shrink-0 cursor-pointer"
                        aria-label={`Select ${user.name}`}
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-gray-900 truncate">{user.name}</p>
                        <Badge variant={roleBadge[user.role] ?? 'gray'}>{user.role}</Badge>
                        <Badge variant={user.is_active ? 'green' : 'red'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>

                      {/* Student Enrollment Status Details */}
                      {user.role === 'student' && (
                        <div className="mt-1 text-xs">
                          {isStudentEnrolled ? (
                            <div className="text-gray-600 space-y-0.5">
                              <p>
                                <span className="font-semibold text-gray-900">{studentRec.classes?.name}</span>
                                {' '}(Sem {studentRec.classes?.semester})
                                {' · '}Roll: <span className="font-mono font-medium">{studentRec.roll_no}</span>
                                {studentRec.batches?.name && ` · ${studentRec.batches.name}`}
                              </p>
                              {studentRec.classes?.departments?.name && (
                                <p className="text-blue-600 text-[11px] font-medium">
                                  Branch: {studentRec.classes.departments.name}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-100 text-amber-800">
                              ⚠ Class Enrollment Pending
                              {studentRec?.roll_no ? ` (Roll: ${studentRec.roll_no})` : ''}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Professor Department Details */}
                      {user.role === 'professor' && (
                        <div className="mt-1 text-xs">
                          {isProfAssigned ? (
                            <div className="space-y-0.5">
                              <p className="text-gray-600 font-medium">
                                Dept: {profRec.departments?.name}
                              </p>
                              <Link
                                to="/admin/assignments"
                                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline font-medium"
                              >
                                <span>Assign Subjects &amp; Classes →</span>
                              </Link>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-100 text-amber-800">
                              ⚠ Department Pending
                            </span>
                          )}
                        </div>
                      )}

                      {/* Admin Status Details */}
                      {user.role === 'admin' && (
                        <div className="mt-1 text-xs text-gray-500">
                          <p>Full Administrator Access &bull; Academic Structure, Users &amp; Timetable</p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg font-medium transition-colors"
                        onClick={() => handleOpenEdit(user)}
                      >
                        <Edit3 size={12} />
                        <span>
                          {user.role === 'student' ? 'Enroll / Role' : user.role === 'professor' ? 'Assign / Role' : 'Manage Role'}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                        onClick={() =>
                          toggleActiveMutation.mutate({ userId: user.id, is_active: user.is_active })
                        }
                      >
                        {user.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            <PaginationControls
              currentPage={page}
              totalPages={calcTotalPages(totalUsersCount, pageSize)}
              totalCount={totalUsersCount}
              pageSize={pageSize}
              onPageChange={setPage}
              isLoading={isUsersLoading}
            />
          </div>
        )}

        {/* Floating Bulk Action Bar */}
        {selectedStudentIds.length > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-md w-[92%] bg-gray-900 text-white rounded-2xl p-3.5 shadow-2xl flex items-center justify-between z-40 animate-in slide-in-from-bottom-4">
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white text-xs px-2.5 py-0.5 rounded-full font-bold">
                {selectedStudentIds.length}
              </span>
              <span className="text-xs font-medium text-gray-200">
                student{selectedStudentIds.length > 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs text-gray-400 hover:text-white px-2 py-1"
                onClick={() => setSelectedStudentIds([])}
              >
                Clear
              </button>
              <Button
                size="sm"
                onClick={() => setShowBulkAssign(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white shadow-md text-xs py-1.5 px-3 flex items-center gap-1"
              >
                <Layers size={14} />
                <span>Bulk Allot</span>
              </Button>
            </div>
          </div>
        )}

        {/* Bulk Class & Curriculum Allotment Modal */}
        <BulkClassAssignModal
          isOpen={showBulkAssign}
          selectedStudentIds={selectedStudentIds}
          departments={departments}
          classes={classes}
          onClose={() => setShowBulkAssign(false)}
          onSuccess={() => {
            setSelectedStudentIds([])
            refetchUsers()
          }}
        />
      </div>
    </div>
  )
}
