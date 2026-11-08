import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Select from '../ui/Select'
import toast from 'react-hot-toast'
import { X, ShieldAlert, Award, GraduationCap, UserCheck } from 'lucide-react'
import { extractSingleRelation } from '../../lib/adminUtils'
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

interface UserEnrollmentModalProps {
  user: any | null
  departments: DepartmentRef[] | undefined
  classes: ClassRef[] | undefined
  onClose: () => void
  onSuccess: () => void
}

export default function UserEnrollmentModal({
  user,
  departments,
  classes,
  onClose,
  onSuccess,
}: UserEnrollmentModalProps) {
  const queryClient = useQueryClient()

  const [selectedRole, setSelectedRole] = useState<Role>('student')
  const [rollNo, setRollNo] = useState('')
  const [classId, setClassId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [studentDeptId, setStudentDeptId] = useState('')

  // Initialize fields whenever user opens
  useEffect(() => {
    if (!user) return

    setSelectedRole(user.role as Role)

    if (user.role === 'student') {
      const studentRec = extractSingleRelation(user.students)
      setRollNo(studentRec?.roll_no ?? '')
      const initialClassId = studentRec?.class_id ? String(studentRec.class_id) : ''
      setClassId(initialClassId)
      setBatchId(studentRec?.batch_id ? String(studentRec.batch_id) : '')

      const initialDeptId = studentRec?.classes?.department_id
        ? String(studentRec.classes.department_id)
        : classes?.find(c => String(c.id) === initialClassId)?.department_id
          ? String(classes.find(c => String(c.id) === initialClassId)?.department_id)
          : ''
      setStudentDeptId(initialDeptId)
      setDepartmentId('')
    } else if (user.role === 'professor') {
      const profRec = extractSingleRelation(user.professors)
      setDepartmentId(profRec?.department_id ? String(profRec.department_id) : '')
      setRollNo('')
      setClassId('')
      setBatchId('')
      setStudentDeptId('')
    } else {
      // Admin
      setRollNo('')
      setClassId('')
      setBatchId('')
      setDepartmentId('')
      setStudentDeptId('')
    }
  }, [user, classes])

  // Batches for selected class
  const { data: editBatches } = useQuery({
    queryKey: ['batches-list', classId],
    enabled: !!classId && selectedRole === 'student',
    queryFn: async () => {
      const { data, error } = await supabase.from('batches').select('*').eq('class_id', Number(classId))
      if (error) throw error
      return data ?? []
    },
  })

  // Save Assignment & Role Transition Mutation via secure RPC admin_set_user_role
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) return

      if (selectedRole === 'student') {
        const trimmedRollNo = rollNo.trim()
        if (!trimmedRollNo) {
          throw new Error('Roll number is required for student role.')
        }

        const classIdNum = classId ? Number(classId) : null
        const batchIdNum = batchId ? Number(batchId) : null

        if (classIdNum !== null && isNaN(classIdNum)) {
          throw new Error('Invalid class division selected.')
        }
        if (batchIdNum !== null && isNaN(batchIdNum)) {
          throw new Error('Invalid practical batch selected.')
        }

        // Validate batch compatibility if specified
        if (batchIdNum !== null && classIdNum !== null && editBatches && editBatches.length > 0) {
          const validBatch = editBatches.some(b => b.id === batchIdNum && b.class_id === classIdNum)
          if (!validBatch) {
            throw new Error('Selected practical batch does not belong to the selected class division.')
          }
        }
      } else if (selectedRole === 'professor') {
        if (!departmentId) {
          throw new Error('Please select an assigned department for the professor.')
        }
        const deptIdNum = Number(departmentId)
        if (isNaN(deptIdNum)) {
          throw new Error('Invalid department selected.')
        }
      }

      // Execute atomic admin role transition RPC
      const { data, error } = await supabase.rpc('admin_set_user_role', {
        p_user_id: user.id,
        p_new_role: selectedRole,
        p_roll_no: selectedRole === 'student' ? rollNo.trim() : null,
        p_class_id: selectedRole === 'student' && classId ? Number(classId) : null,
        p_batch_id: selectedRole === 'student' && batchId ? Number(batchId) : null,
        p_department_id: selectedRole === 'professor' && departmentId ? Number(departmentId) : null,
      })

      if (error) throw error
      return data
    },
    onSuccess: () => {
      const roleName = selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)
      toast.success(
        selectedRole !== user?.role
          ? `User promoted/reassigned to ${roleName} successfully!`
          : `${roleName} details updated and verified!`
      )
      onSuccess()
      onClose()
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['professors-list'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      queryClient.invalidateQueries({ queryKey: ['professor-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['professor-all-assignments'] })
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Failed to update user role/assignment')
    },
  })

  if (!user) return null

  const isRoleChanged = selectedRole !== user.role

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="font-bold text-gray-900 text-base">
              Manage Account &amp; Role
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {user.name} &bull; Current Role:{' '}
              <span className="font-medium text-gray-800 capitalize">{user.role}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Role Selector */}
        <div>
          <Select
            label="Account Role"
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value as Role)}
            options={[
              { value: 'student', label: 'Student' },
              { value: 'professor', label: 'Professor' },
              { value: 'admin', label: 'Administrator' },
            ]}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Accounts cannot co-exist across multiple roles. Changing the role cleanly transitions the user and retires obsolete records.
          </p>
        </div>

        {/* Notice if role changed */}
        {isRoleChanged && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900 flex items-start gap-2.5">
            <ShieldAlert size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Role Transition Warning</p>
              <p className="mt-0.5 text-amber-800">
                Switching from <strong className="capitalize">{user.role}</strong> to{' '}
                <strong className="capitalize">{selectedRole}</strong>.
                {selectedRole === 'admin' && ' This grants full portal administrative privileges.'}
                {selectedRole === 'professor' && ' Student records and enrollments will be retired.'}
                {selectedRole === 'student' && ' Professor department assignments will be retired.'}
              </p>
            </div>
          </div>
        )}

        {/* Student Specific Fields */}
        {selectedRole === 'student' && (
          <div className="space-y-3 bg-blue-50/40 border border-blue-100 rounded-2xl p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 mb-1">
              <GraduationCap size={15} />
              <span>Student Enrollment Details</span>
            </div>

            <Input
              label="Roll Number"
              placeholder="e.g. CS2401"
              value={rollNo}
              onChange={e => setRollNo(e.target.value)}
            />

            {/* Academic Department / Branch Filter */}
            <div>
              <Select
                label="Academic Department / Branch"
                placeholder="Select department / branch..."
                value={studentDeptId}
                onChange={e => {
                  const newDeptId = e.target.value
                  setStudentDeptId(newDeptId)
                  if (newDeptId && classId) {
                    const cls = classes?.find(c => String(c.id) === classId)
                    if (cls && String(cls.department_id) !== newDeptId) {
                      setClassId('')
                      setBatchId('')
                    }
                  }
                }}
                options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Filter class divisions by academic branch.
              </p>
            </div>

            <Select
              label="Class Division"
              placeholder="Select class division..."
              value={classId}
              onChange={e => {
                const newClassId = e.target.value
                setClassId(newClassId)
                setBatchId('')
                if (newClassId) {
                  const cls = classes?.find(c => String(c.id) === newClassId)
                  if (cls?.department_id) {
                    setStudentDeptId(String(cls.department_id))
                  }
                }
              }}
              options={(studentDeptId
                ? classes?.filter(c => String(c.department_id) === studentDeptId)
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
                value={batchId}
                onChange={e => setBatchId(e.target.value)}
                options={editBatches.map(b => ({ value: b.id, label: b.name }))}
              />
            )}

            {(() => {
              const selectedClass = classes?.find(c => String(c.id) === classId)
              if (!selectedClass) return null
              const deptName =
                (selectedClass.departments as any)?.name ??
                departments?.find(d => d.id === selectedClass.department_id)?.name
              return (
                <div className="bg-white border border-blue-200 rounded-xl p-2.5 text-xs text-blue-900 shadow-2xs">
                  <p className="font-semibold">{selectedClass.name} — Semester {selectedClass.semester}</p>
                  <p className="text-blue-700 mt-0.5">Academic Branch: {deptName ?? 'Unassigned'}</p>
                  {batchId ? (
                    <p className="text-blue-600 mt-0.5">
                      Batch: {editBatches?.find(b => String(b.id) === batchId)?.name}
                    </p>
                  ) : (
                    <p className="text-gray-500 mt-0.5">General enrollment (all practical batches)</p>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* Professor Specific Fields */}
        {selectedRole === 'professor' && (
          <div className="space-y-3 bg-indigo-50/40 border border-indigo-100 rounded-2xl p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-900 mb-1">
              <UserCheck size={15} />
              <span>Professor Department Assignment</span>
            </div>

            <Select
              label="Assigned Department"
              placeholder="Select department..."
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value)}
              options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
            />
            <p className="text-xs text-gray-500">
              Professors can be assigned teaching subjects and manage attendance for their assigned classes.
            </p>
          </div>
        )}

        {/* Admin Specific Notice */}
        {selectedRole === 'admin' && (
          <div className="bg-purple-50/60 border border-purple-100 rounded-2xl p-4 text-xs text-purple-900 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-purple-950">
              <Award size={16} className="text-purple-600" />
              <span>Administrator Privileges</span>
            </div>
            <p className="text-purple-800">
              Administrators possess elevated authority to manage college academic structures, subjects, users, timetable schedules, and attendance policy settings.
            </p>
            <p className="text-[11px] text-purple-600">
              Administrator accounts do not require student enrollment or professor department assignments.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {isRoleChanged ? 'Save & Change Role' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
