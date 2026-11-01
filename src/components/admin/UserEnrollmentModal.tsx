import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Select from '../ui/Select'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { extractSingleRelation } from '../../lib/adminUtils'

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

  const [rollNo, setRollNo] = useState('')
  const [classId, setClassId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [studentDeptId, setStudentDeptId] = useState('')

  // Initialize fields whenever user opens
  useEffect(() => {
    if (!user) return

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
    } else if (user.role === 'professor') {
      const profRec = extractSingleRelation(user.professors)
      setDepartmentId(profRec?.department_id ? String(profRec.department_id) : '')
    }
  }, [user, classes])

  // Batches for selected class
  const { data: editBatches } = useQuery({
    queryKey: ['batches-list', classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase.from('batches').select('*').eq('class_id', Number(classId))
      if (error) throw error
      return data ?? []
    },
  })

  // Save Assignment Mutation with read-after-write verification
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) return

      if (user.role === 'student') {
        const trimmedRollNo = rollNo.trim()
        if (!trimmedRollNo) {
          throw new Error('Roll number is required for student enrollment.')
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

        // Check roll number uniqueness
        const { data: existingStudentWithRoll, error: rollCheckErr } = await supabase
          .from('students')
          .select('id, user_id, roll_no')
          .eq('roll_no', trimmedRollNo)
          .maybeSingle()

        if (rollCheckErr) throw rollCheckErr
        if (existingStudentWithRoll && existingStudentWithRoll.user_id !== user.id) {
          throw new Error(`Roll number "${trimmedRollNo}" is already assigned to another student.`)
        }

        // Upsert student with confirmed read-after-write
        const { data: savedStudent, error: studentError } = await supabase
          .from('students')
          .upsert(
            {
              user_id: user.id,
              roll_no: trimmedRollNo,
              class_id: classIdNum,
              batch_id: batchIdNum,
            },
            { onConflict: 'user_id' }
          )
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
      } else if (user.role === 'professor') {
        if (!departmentId) {
          throw new Error('Please select a department for this professor.')
        }

        const deptIdNum = Number(departmentId)
        if (isNaN(deptIdNum)) {
          throw new Error('Invalid department selected.')
        }

        // Upsert professor with confirmed read-after-write
        const { data: savedProf, error: profError } = await supabase
          .from('professors')
          .upsert(
            {
              user_id: user.id,
              department_id: deptIdNum,
            },
            { onConflict: 'user_id' }
          )
          .select('id, user_id, department_id, departments(id, name)')

        if (profError) throw profError
        if (!savedProf || savedProf.length === 0) {
          throw new Error('Failed to persist professor department assignment. Zero rows were updated in the database.')
        }

        return { role: 'professor', data: savedProf[0] }
      }
    },
    onSuccess: result => {
      toast.success(
        result?.role === 'student'
          ? 'Student enrollment updated and verified!'
          : 'Professor department assigned and verified!'
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
      toast.error(err.message ?? 'Failed to update assignment')
    },
  })

  if (!user) return null

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="font-bold text-gray-900 text-base">
              {user.role === 'student' ? 'Manage Student Enrollment' : 'Assign Professor Department'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{user.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {user.role === 'student' && (
          <div className="space-y-3">
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
                Filtering class divisions by department. Students belong to a branch via their class enrollment.
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
                <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-2.5 text-xs text-blue-900">
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

        {user.role === 'professor' && (
          <div className="space-y-3">
            <Select
              label="Assigned Department"
              placeholder="Select department..."
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value)}
              options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
            />
            <p className="text-xs text-gray-500">
              Department professors are permitted to mark attendance for their assigned subject teaching assignments.
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
            Save Assignment
          </Button>
        </div>
      </div>
    </div>
  )
}
