import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Select from '../ui/Select'
import toast from 'react-hot-toast'
import { BookOpen } from 'lucide-react'
import { normalizeEmail, validateEmail } from '../../lib/authUtils'
import type { Role } from '../../types'

interface DepartmentRef {
  id: number
  name: string
}

interface ClassRef {
  id: number
  name: string
  semester: number
  department_id: number
  departments?: { id: number; name: string }
}

interface AddUserCardProps {
  isOpen: boolean
  departments: DepartmentRef[] | undefined
  classes: ClassRef[] | undefined
  onSuccess: () => void
  onClose: () => void
}

interface NewUserForm {
  name: string
  email: string
  password: string
  role: Role
  rollNo: string
  branchId: string
  semester: string
  classId: string
  batchId: string
  departmentId: string
}

export default function AddUserCard({
  isOpen,
  departments,
  classes,
  onSuccess,
  onClose,
}: AddUserCardProps) {
  const queryClient = useQueryClient()

  const [form, setForm] = useState<NewUserForm>({
    name: '',
    email: '',
    password: '',
    role: 'student',
    rollNo: '',
    branchId: '',
    semester: '1',
    classId: '',
    batchId: '',
    departmentId: '',
  })

  // Batches for creation form
  const { data: formBatches } = useQuery({
    queryKey: ['batches-list', form.classId],
    enabled: !!form.classId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('*')
        .eq('class_id', Number(form.classId))
      if (error) throw error
      return data ?? []
    },
  })

  // Allotted subjects for creation form preview
  const { data: formAllottedSubjects } = useQuery({
    queryKey: ['class-allotted-subjects', form.classId],
    enabled: !!form.classId && form.role === 'student',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select('subject_id, subjects(id, name, code, type)')
        .eq('class_id', Number(form.classId))
      if (error) throw error
      const map = new Map<number, any>()
      data?.forEach((a: any) => {
        if (a.subjects) map.set(a.subjects.id, a.subjects)
      })
      return Array.from(map.values())
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

      const { data: funcData, error: funcError } = await supabase.functions.invoke(
        'admin-create-user',
        {
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
        }
      )

      if (funcError) {
        let msg = funcError.message || 'Failed to communicate with admin-create-user Edge Function.'
        if (
          msg.includes('non-2xx') ||
          msg.includes('404') ||
          (funcError as any)?.context?.status === 404
        ) {
          msg =
            "Edge Function 'admin-create-user' is not deployed (HTTP 404). Please deploy it via Supabase CLI ('supabase functions deploy admin-create-user') or provision the user in the Supabase Dashboard."
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
      setForm({
        name: '',
        email: '',
        password: '',
        role: 'student',
        rollNo: '',
        branchId: '',
        semester: '1',
        classId: '',
        batchId: '',
        departmentId: '',
      })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      onSuccess()
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Failed to create user')
    },
  })

  if (!isOpen) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900 text-sm">Create New Account</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>

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
              label="Branch / Department"
              placeholder="Select branch..."
              value={form.branchId}
              onChange={e => {
                const newBranch = e.target.value
                const matches =
                  classes?.filter(
                    c =>
                      (!newBranch || String(c.department_id) === newBranch) &&
                      (!form.semester || String(c.semester) === form.semester)
                  ) ?? []
                setForm({
                  ...form,
                  branchId: newBranch,
                  classId: matches.length === 1 ? String(matches[0].id) : '',
                  batchId: '',
                })
              }}
              options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
            />

            <Select
              label="Semester"
              value={form.semester}
              onChange={e => {
                const newSem = e.target.value
                const matches =
                  classes?.filter(
                    c =>
                      (!form.branchId || String(c.department_id) === form.branchId) &&
                      (!newSem || String(c.semester) === newSem)
                  ) ?? []
                setForm({
                  ...form,
                  semester: newSem,
                  classId: matches.length === 1 ? String(matches[0].id) : '',
                  batchId: '',
                })
              }}
              options={[
                { value: '1', label: 'Semester 1' },
                { value: '2', label: 'Semester 2' },
                { value: '3', label: 'Semester 3' },
                { value: '4', label: 'Semester 4' },
                { value: '5', label: 'Semester 5' },
                { value: '6', label: 'Semester 6' },
                { value: '7', label: 'Semester 7' },
                { value: '8', label: 'Semester 8' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Select
              label="Class Division"
              value={form.classId}
              onChange={e => {
                const newClassId = e.target.value
                const cls = classes?.find(c => String(c.id) === newClassId)
                setForm({
                  ...form,
                  classId: newClassId,
                  batchId: '',
                  branchId: cls?.department_id ? String(cls.department_id) : form.branchId,
                  semester: cls?.semester ? String(cls.semester) : form.semester,
                })
              }}
              placeholder="Select class division..."
              options={(
                classes?.filter(c => {
                  if (form.branchId && String(c.department_id) !== form.branchId) return false
                  if (form.semester && String(c.semester) !== form.semester) return false
                  return true
                }) ??
                classes ??
                []
              )?.map(c => ({
                value: c.id,
                label: `${c.name} — Sem ${c.semester} (${(c.departments as any)?.name ?? 'Dept'})`,
              })) ?? []}
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

          {/* Allotted Subjects Preview in Add User Form */}
          {formAllottedSubjects && formAllottedSubjects.length > 0 && (
            <div className="bg-white border border-blue-200 rounded-xl p-2.5 text-xs text-blue-900 shadow-2xs space-y-1.5">
              <p className="font-semibold text-blue-950 flex items-center gap-1.5">
                <BookOpen size={13} className="text-blue-600" />
                <span>Allotted Curriculum Pool ({formAllottedSubjects.length} subjects)</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {formAllottedSubjects.map(s => (
                  <span
                    key={s.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-medium text-[11px]"
                    title={`${s.name} (${s.code})`}
                  >
                    {s.code || s.name}
                  </span>
                ))}
              </div>
            </div>
          )}
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
  )
}
