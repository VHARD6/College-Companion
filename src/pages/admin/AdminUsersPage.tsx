import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import { UserPlus, FileSpreadsheet, Search, Edit3, X, AlertCircle, RefreshCw } from 'lucide-react'
import { normalizeEmail, validateEmail } from '../../lib/authUtils'
import type { Role } from '../../types'

import { extractSingleRelation } from '../../lib/adminUtils'

interface NewUserForm {
  name: string
  email: string
  password: string
  role: Role
  rollNo: string
  classId: string
  batchId: string
  departmentId: string
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient()
  const [showAddForm, setShowAddForm] = useState(false)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')

  // Creation form state
  const [form, setForm] = useState<NewUserForm>({
    name: '',
    email: '',
    password: '',
    role: 'student',
    rollNo: '',
    classId: '',
    batchId: '',
    departmentId: '',
  })

  // Enrollment / Assignment modal state
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [editRollNo, setEditRollNo] = useState('')
  const [editClassId, setEditClassId] = useState('')
  const [editBatchId, setEditBatchId] = useState('')
  const [editDepartmentId, setEditDepartmentId] = useState('')
  const [editStudentDeptId, setEditStudentDeptId] = useState('')

  const [csvText, setCsvText] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  // Fetch all user profiles with attached student & professor records
  const {
    data: users,
    isLoading: isUsersLoading,
    isError: isUsersError,
    error: usersError,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data, error } = await supabase
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
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
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

  // Batches for creation form
  const { data: formBatches } = useQuery({
    queryKey: ['batches-list', form.classId],
    enabled: !!form.classId,
    queryFn: async () => {
      const { data, error } = await supabase.from('batches').select('*').eq('class_id', Number(form.classId))
      if (error) throw error
      return data ?? []
    },
  })

  // Batches for edit modal
  const { data: editBatches } = useQuery({
    queryKey: ['batches-list', editClassId],
    enabled: !!editClassId,
    queryFn: async () => {
      const { data, error } = await supabase.from('batches').select('*').eq('class_id', Number(editClassId))
      if (error) throw error
      return data ?? []
    },
  })

  // Create Single User Mutation (Strictly through secure Edge Function)
  const createUserMutation = useMutation({
    mutationFn: async () => {
      if (!form.name || !form.email || !form.password) {
        throw new Error('Name, email, and password are required.')
      }

      const cleanEmail = normalizeEmail(form.email)
      const emailCheck = validateEmail(cleanEmail)
      if (!emailCheck.isValid) {
        throw new Error(emailCheck.error)
      }

      // Invoke server-side Edge Function with service-role security
      const { data: funcData, error: funcError } = await supabase.functions.invoke('admin-create-user', {
        body: {
          name: form.name.trim(),
          email: cleanEmail,
          password: form.password,
          role: form.role,
          rollNo: form.rollNo,
          classId: form.classId,
          batchId: form.batchId,
          departmentId: form.departmentId,
        },
      })

      if (funcError) {
        let msg = funcError.message || 'Failed to communicate with admin-create-user Edge Function.'
        if (msg.includes('non-2xx') || msg.includes('404') || (funcError as any)?.context?.status === 404) {
          msg = "Edge Function 'admin-create-user' is not deployed (HTTP 404). Please deploy it via Supabase CLI ('supabase functions deploy admin-create-user') or provision the user in the Supabase Dashboard."
        }
        throw new Error(msg)
      }

      if (funcData?.error) {
        throw new Error(funcData.error)
      }

      if (!funcData?.success) {
        throw new Error('User creation did not return success confirmation.')
      }

      return funcData.user
    },
    onSuccess: () => {
      toast.success(`User ${form.name} created!`)
      setShowAddForm(false)
      setForm({
        name: '',
        email: '',
        password: '',
        role: 'student',
        rollNo: '',
        classId: '',
        batchId: '',
        departmentId: '',
      })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Failed to create user')
    },
  })

  // Save Enrollment / Department assignment mutation with read-after-write verification
  const saveAssignmentMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) return

      if (editingUser.role === 'student') {
        const trimmedRollNo = editRollNo.trim()
        if (!trimmedRollNo) {
          throw new Error('Roll number is required for student enrollment.')
        }

        const classIdNum = editClassId ? Number(editClassId) : null
        const batchIdNum = editBatchId ? Number(editBatchId) : null

        if (classIdNum !== null && isNaN(classIdNum)) {
          throw new Error('Invalid class division selected.')
        }
        if (batchIdNum !== null && isNaN(batchIdNum)) {
          throw new Error('Invalid practical batch selected.')
        }

        // Validate batch compatibility if a batch is specified
        if (batchIdNum !== null && classIdNum !== null && editBatches && editBatches.length > 0) {
          const validBatch = editBatches.some(b => b.id === batchIdNum && b.class_id === classIdNum)
          if (!validBatch) {
            throw new Error('Selected practical batch does not belong to the selected class division.')
          }
        }

        // Check roll number uniqueness before upsert
        const { data: existingStudentWithRoll, error: rollCheckErr } = await supabase
          .from('students')
          .select('id, user_id, roll_no')
          .eq('roll_no', trimmedRollNo)
          .maybeSingle()

        if (rollCheckErr) throw rollCheckErr
        if (existingStudentWithRoll && existingStudentWithRoll.user_id !== editingUser.id) {
          throw new Error(`Roll number "${trimmedRollNo}" is already assigned to another student.`)
        }

        // Upsert student with confirmed read-after-write
        const { data: savedStudent, error: studentError } = await supabase
          .from('students')
          .upsert({
            user_id: editingUser.id,
            roll_no: trimmedRollNo,
            class_id: classIdNum,
            batch_id: batchIdNum,
          }, { onConflict: 'user_id' })
          .select(`
            id,
            user_id,
            roll_no,
            class_id,
            batch_id,
            classes(id, name, semester, department_id, departments(id, name)),
            batches(id, name)
          `)

        if (studentError) throw studentError
        if (!savedStudent || savedStudent.length === 0) {
          throw new Error('Failed to persist student enrollment. Zero rows were updated in the database.')
        }

        return { role: 'student', data: savedStudent[0] }
      } else if (editingUser.role === 'professor') {
        if (!editDepartmentId) {
          throw new Error('Please select a department for this professor.')
        }

        const deptIdNum = Number(editDepartmentId)
        if (isNaN(deptIdNum)) {
          throw new Error('Invalid department selected.')
        }

        // Upsert professor with confirmed read-after-write
        const { data: savedProf, error: profError } = await supabase
          .from('professors')
          .upsert({
            user_id: editingUser.id,
            department_id: deptIdNum,
          }, { onConflict: 'user_id' })
          .select('id, user_id, department_id, departments(id, name)')

        if (profError) throw profError
        if (!savedProf || savedProf.length === 0) {
          throw new Error('Failed to persist professor department assignment. Zero rows were updated in the database.')
        }

        return { role: 'professor', data: savedProf[0] }
      }
    },
    onSuccess: (result) => {
      toast.success(
        result?.role === 'student'
          ? 'Student enrollment updated and verified!'
          : 'Professor department assigned and verified!'
      )
      setEditingUser(null)
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['professors-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      queryClient.invalidateQueries({ queryKey: ['professor-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['professor-all-assignments'] })
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Failed to update assignment')
    },
  })

  // Open modal with pre-populated values using extractSingleRelation
  const handleOpenEdit = (user: any) => {
    setEditingUser(user)
    if (user.role === 'student') {
      const studentRec = extractSingleRelation(user.students)
      setEditRollNo(studentRec?.roll_no ?? '')
      const initialClassId = studentRec?.class_id ? String(studentRec.class_id) : ''
      setEditClassId(initialClassId)
      setEditBatchId(studentRec?.batch_id ? String(studentRec.batch_id) : '')

      // Auto-populate department from student's enrolled class if present
      const initialDeptId = studentRec?.classes?.department_id
        ? String(studentRec.classes.department_id)
        : classes?.find(c => String(c.id) === initialClassId)?.department_id
          ? String(classes.find(c => String(c.id) === initialClassId)?.department_id)
          : ''
      setEditStudentDeptId(initialDeptId)
    } else if (user.role === 'professor') {
      const profRec = extractSingleRelation(user.professors)
      setEditDepartmentId(profRec?.department_id ? String(profRec.department_id) : '')
    }
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

  // Bulk CSV Import (Strictly through secure Edge Function)
  async function handleCsvImport() {
    if (!csvText.trim()) {
      toast.error('Please enter CSV data')
      return
    }

    const lines = csvText.trim().split('\n')
    if (lines.length <= 1) {
      toast.error('CSV must contain a header and at least one data row')
      return
    }

    setIsImporting(true)
    let successCount = 0
    let errorCount = 0

    // Header: name,email,password,roll_no,class_name,batch_name
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const parts = line.split(',').map(p => p.trim())
      const [name, email, password, roll_no, class_name, batch_name] = parts

      if (!name || !email || !password || !roll_no || !class_name) {
        errorCount++
        continue
      }

      try {
        const targetClass = classes?.find(c => c.name.toLowerCase() === class_name.toLowerCase())
        if (!targetClass) {
          throw new Error(`Class ${class_name} not found`)
        }

        let targetBatchId: number | null = null
        if (batch_name) {
          const { data: bData, error: bErr } = await supabase
            .from('batches')
            .select('id')
            .eq('class_id', targetClass.id)
            .ilike('name', batch_name)
            .maybeSingle()
          if (!bErr && bData) targetBatchId = bData.id
        }

        const cleanEmail = normalizeEmail(email)
        const emailCheck = validateEmail(cleanEmail)
        if (!emailCheck.isValid) {
          throw new Error(`Line ${i}: ${emailCheck.error}`)
        }

        // Provision via admin-create-user Edge Function
        const { data: funcData, error: funcError } = await supabase.functions.invoke('admin-create-user', {
          body: {
            name: name.trim(),
            email: cleanEmail,
            password,
            role: 'student',
            rollNo: roll_no.trim(),
            classId: String(targetClass.id),
            batchId: targetBatchId ? String(targetBatchId) : undefined,
          },
        })

        if (funcError || !funcData?.success) {
          let msg = funcError?.message || funcData?.error || 'Failed to create student'
          if (msg.includes('non-2xx') || msg.includes('404') || (funcError as any)?.context?.status === 404) {
            msg = "Edge Function 'admin-create-user' is not deployed (HTTP 404). Deploy with 'supabase functions deploy admin-create-user'."
          }
          throw new Error(msg)
        }

        successCount++
      } catch (e) {
        console.error('Import error on line', i, e)
        errorCount++
      }
    }

    setIsImporting(false)
    setShowCsvImport(false)
    setCsvText('')
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    toast.success(`CSV Import complete: ${successCount} added, ${errorCount} errors.`)
  }

  // Filtered user list
  const filteredUsers = users?.filter(u => {
    const matchesRole = roleFilter === 'all' || u.role === roleFilter
    const q = search.toLowerCase().trim()
    const studentRec = extractSingleRelation(u.students)
    const profRec = extractSingleRelation(u.professors)
    const matchesSearch =
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q) ||
      studentRec?.roll_no?.toLowerCase().includes(q) ||
      studentRec?.classes?.name?.toLowerCase().includes(q) ||
      profRec?.departments?.name?.toLowerCase().includes(q)

    return matchesRole && matchesSearch
  })

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

        {/* Add User Modal / Card */}
        {showAddForm && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
            <h3 className="font-bold text-gray-900 text-sm">Create New Account</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Full Name"
                placeholder="e.g. Ramesh Kumar"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                placeholder="ramesh@gmail.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
              />
              <Select
                label="Account Role"
                value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value as Role })}
                options={[
                  { value: 'student', label: 'Student' },
                  { value: 'professor', label: 'Professor' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />
            </div>

            {/* Student specific fields */}
            {form.role === 'student' && (
              <div className="p-3 bg-blue-50/60 rounded-xl space-y-3">
                <Input
                  label="Roll Number"
                  placeholder="e.g. CS2401"
                  value={form.rollNo}
                  onChange={e => setForm({ ...form, rollNo: e.target.value })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Select
                    label="Class"
                    value={form.classId}
                    onChange={e => setForm({ ...form, classId: e.target.value, batchId: '' })}
                    placeholder="Select class (optional pending)..."
                    options={classes?.map(c => ({ value: c.id, label: `${c.name} (Sem ${c.semester})` })) ?? []}
                  />
                  {formBatches && formBatches.length > 0 && (
                    <Select
                      label="Batch (Optional for practicals)"
                      value={form.batchId}
                      onChange={e => setForm({ ...form, batchId: e.target.value })}
                      placeholder="All batches"
                      options={formBatches.map(b => ({ value: b.id, label: b.name }))}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Professor specific fields */}
            {form.role === 'professor' && (
              <div className="p-3 bg-indigo-50/60 rounded-xl">
                <Select
                  label="Department"
                  value={form.departmentId}
                  onChange={e => setForm({ ...form, departmentId: e.target.value })}
                  placeholder="Select department..."
                  options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
                />
              </div>
            )}

            <Button
              className="w-full"
              loading={createUserMutation.isPending}
              onClick={() => createUserMutation.mutate()}
            >
              Create Account
            </Button>
          </div>
        )}

        {/* CSV Import Card */}
        {showCsvImport && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">Bulk Import Students via CSV</h3>
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => {
                  const firstClass = classes?.[0]?.name ?? 'CS-A'
                  setCsvText(
                    `name,email,password,roll_no,class_name,batch_name\nAakash Sharma,aakash@gmail.com,Pass1234,CS001,${firstClass},Batch 1\nBhavna Patel,bhavna@gmail.com,Pass1234,CS002,${firstClass},Batch 1\nChirag Verma,chirag@gmail.com,Pass1234,CS003,${firstClass},Batch 2`
                  )
                }}
              >
                Fill Sample Data
              </button>
            </div>

            <p className="text-xs text-gray-500">
              Format: <code>name,email,password,roll_no,class_name,batch_name</code>. The header row is required.
            </p>

            <textarea
              className="w-full font-mono text-xs border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={6}
              placeholder="name,email,password,roll_no,class_name,batch_name"
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
            />

            <Button
              className="w-full"
              loading={isImporting}
              onClick={handleCsvImport}
            >
              Start Import
            </Button>
          </div>
        )}

        {/* Edit Enrollment / Department Modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div>
                  <h3 className="font-bold text-gray-900 text-base">
                    {editingUser.role === 'student' ? 'Manage Student Enrollment' : 'Assign Professor Department'}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">{editingUser.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100"
                >
                  <X size={18} />
                </button>
              </div>

              {editingUser.role === 'student' && (
                <div className="space-y-3">
                  <Input
                    label="Roll Number"
                    placeholder="e.g. CS2401"
                    value={editRollNo}
                    onChange={e => setEditRollNo(e.target.value)}
                  />

                  {/* Academic Department / Branch Filter */}
                  <div>
                    <Select
                      label="Academic Department / Branch"
                      placeholder="Select department / branch..."
                      value={editStudentDeptId}
                      onChange={e => {
                        const newDeptId = e.target.value
                        setEditStudentDeptId(newDeptId)
                        if (newDeptId && editClassId) {
                          const cls = classes?.find(c => String(c.id) === editClassId)
                          if (cls && String(cls.department_id) !== newDeptId) {
                            setEditClassId('')
                            setEditBatchId('')
                          }
                        }
                      }}
                      options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
                    />
                    <p className="text-[11px] text-gray-500 mt-1">
                      Filtering class divisions by department. Students belong to a branch via their class enrollment.
                    </p>
                  </div>

                  <Select
                    label="Class Division"
                    placeholder="Select class division..."
                    value={editClassId}
                    onChange={e => {
                      const newClassId = e.target.value
                      setEditClassId(newClassId)
                      setEditBatchId('')
                      if (newClassId) {
                        const cls = classes?.find(c => String(c.id) === newClassId)
                        if (cls?.department_id) {
                          setEditStudentDeptId(String(cls.department_id))
                        }
                      }
                    }}
                    options={(editStudentDeptId
                      ? classes?.filter(c => String(c.department_id) === editStudentDeptId)
                      : classes
                    )?.map(c => ({
                      value: c.id,
                      label: `${c.name} — Sem ${c.semester} (${(c.departments as any)?.name ?? 'Dept'})`,
                    })) ?? []}
                  />

                  {editBatches && editBatches.length > 0 && (
                    <Select
                      label="Practical Batch (Optional)"
                      placeholder="General / All Batches"
                      value={editBatchId}
                      onChange={e => setEditBatchId(e.target.value)}
                      options={editBatches.map(b => ({ value: b.id, label: b.name }))}
                    />
                  )}

                  {(() => {
                    const selectedClass = classes?.find(c => String(c.id) === editClassId)
                    if (!selectedClass) return null
                    const deptName = (selectedClass.departments as any)?.name ?? departments?.find(d => d.id === selectedClass.department_id)?.name
                    return (
                      <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-2.5 text-xs text-blue-900">
                        <span className="font-semibold">Derived Branch:</span>{' '}
                        {deptName || 'Assigned'}
                        <span className="text-blue-600 block text-[11px] mt-0.5">
                          Academic Year: {selectedClass.academic_year} · Semester {selectedClass.semester}
                        </span>
                      </div>
                    )
                  })()}
                </div>
              )}

              {editingUser.role === 'professor' && (
                <div className="space-y-3">
                  <Select
                    label="Department"
                    placeholder="Select department..."
                    value={editDepartmentId}
                    onChange={e => setEditDepartmentId(e.target.value)}
                    options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setEditingUser(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  loading={saveAssignmentMutation.isPending}
                  onClick={() => saveAssignmentMutation.mutate()}
                >
                  Save Assignment
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Search & Role Filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search by name, roll no, or class..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

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
                onClick={() => setRoleFilter(r)}
              >
                {r === 'all' ? 'All Roles' : `${r}s`}
              </button>
            ))}
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
            {filteredUsers?.map(user => {
              const studentRec = extractSingleRelation(user.students)
              const profRec = extractSingleRelation(user.professors)

              const isStudentEnrolled = studentRec && studentRec.class_id
              const isProfAssigned = profRec && profRec.department_id

              return (
                <div
                  key={user.id}
                  className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-2xs space-y-2 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
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
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(user.role === 'student' || user.role === 'professor') && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg font-medium transition-colors"
                          onClick={() => handleOpenEdit(user)}
                        >
                          <Edit3 size={12} />
                          <span>{user.role === 'student' ? 'Enroll' : 'Assign'}</span>
                        </button>
                      )}

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
          </div>
        )}
      </div>
    </div>
  )
}
