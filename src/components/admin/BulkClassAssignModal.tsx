import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import Select from '../ui/Select'
import toast from 'react-hot-toast'
import { X, BookOpen, Layers, Users, CheckCircle2 } from 'lucide-react'

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

interface BulkClassAssignModalProps {
  isOpen: boolean
  selectedStudentIds: number[]
  departments: DepartmentRef[] | undefined
  classes: ClassRef[] | undefined
  onClose: () => void
  onSuccess: () => void
}

export default function BulkClassAssignModal({
  isOpen,
  selectedStudentIds,
  departments,
  classes,
  onClose,
  onSuccess,
}: BulkClassAssignModalProps) {
  const queryClient = useQueryClient()

  const [branchId, setBranchId] = useState('')
  const [semester, setSemester] = useState('1')
  const [classId, setClassId] = useState('')
  const [batchStrategy, setBatchStrategy] = useState<'auto' | 'specific' | 'none'>('auto')
  const [specificBatchId, setSpecificBatchId] = useState('')

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      setBranchId('')
      setSemester('1')
      setClassId('')
      setBatchStrategy('auto')
      setSpecificBatchId('')
    }
  }, [isOpen])

  // Batches for the selected class
  const { data: classBatches } = useQuery({
    queryKey: ['batches-list', classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('*')
        .eq('class_id', Number(classId))
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Dynamic Allotted Subjects for the selected class
  const { data: allottedSubjects } = useQuery({
    queryKey: ['class-allotted-subjects', classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select('subject_id, subjects(id, name, code, type)')
        .eq('class_id', Number(classId))
      if (error) throw error
      const map = new Map<number, any>()
      data?.forEach((a: any) => {
        if (a.subjects) map.set(a.subjects.id, a.subjects)
      })
      return Array.from(map.values())
    },
  })

  // Filter matching classes
  const matchingClasses = useMemo(() => {
    return classes?.filter(c => {
      if (branchId && String(c.department_id) !== branchId) return false
      if (semester && String(c.semester) !== semester) return false
      return true
    }) ?? []
  }, [classes, branchId, semester])

  // Auto-select class division if exactly 1 matches
  useEffect(() => {
    if (branchId && semester) {
      if (matchingClasses.length === 1) {
        setClassId(String(matchingClasses[0].id))
      }
    }
  }, [branchId, semester, matchingClasses])

  // Bulk assign mutation
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!classId) {
        throw new Error('Please select a target class division.')
      }
      if (selectedStudentIds.length === 0) {
        throw new Error('No students selected for allotment.')
      }

      const targetClassId = Number(classId)
      const targetBatchId =
        batchStrategy === 'specific' && specificBatchId ? Number(specificBatchId) : null
      const autoDistribute = batchStrategy === 'auto'

      const { data, error } = await supabase.rpc('admin_bulk_assign_students', {
        p_student_ids: selectedStudentIds,
        p_class_id: targetClassId,
        p_batch_id: targetBatchId,
        p_auto_distribute_batches: autoDistribute,
      })

      if (error) throw error
      return data
    },
    onSuccess: (data: any) => {
      toast.success(
        `Successfully allotted ${data?.updated_count ?? selectedStudentIds.length} students!`
      )
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      onSuccess()
      onClose()
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Bulk assignment failed')
    },
  })

  if (!isOpen) return null

  const selectedClass = classes?.find(c => String(c.id) === classId)
  const branchName =
    departments?.find(d => String(d.id) === branchId)?.name ??
    (selectedClass?.departments as any)?.name

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
              <Layers size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base">
                Bulk Allot Students
              </h3>
              <p className="text-xs text-gray-500">
                Assign Branch, Semester &amp; Practical Batches
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Selected count banner */}
        <div className="bg-blue-50 border border-blue-200/80 rounded-2xl p-3 flex items-center gap-2 text-xs text-blue-900">
          <Users size={16} className="text-blue-600 shrink-0" />
          <span>
            Targeting <strong>{selectedStudentIds.length}</strong> selected student
            {selectedStudentIds.length > 1 ? 's' : ''} for atomic allotment.
          </span>
        </div>

        {/* Branch & Semester Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Select
              label="Branch / Department"
              placeholder="Select branch..."
              value={branchId}
              onChange={e => {
                const newBranch = e.target.value
                setBranchId(newBranch)
                setClassId('')
                setSpecificBatchId('')
              }}
              options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
            />
          </div>

          <div>
            <Select
              label="Semester"
              value={semester}
              onChange={e => {
                const newSem = e.target.value
                setSemester(newSem)
                setClassId('')
                setSpecificBatchId('')
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
        </div>

        {/* Target Class Division */}
        <div>
          <Select
            label="Target Class Division"
            placeholder="Select class division..."
            value={classId}
            onChange={e => {
              const newClassId = e.target.value
              setClassId(newClassId)
              setSpecificBatchId('')
              if (newClassId) {
                const cls = classes?.find(c => String(c.id) === newClassId)
                if (cls) {
                  if (cls.department_id) setBranchId(String(cls.department_id))
                  if (cls.semester) setSemester(String(cls.semester))
                }
              }
            }}
            options={matchingClasses.map(c => ({
              value: c.id,
              label: `${c.name} — Sem ${c.semester} (${(c.departments as any)?.name ?? 'Dept'})`,
            }))}
          />
        </div>

        {/* Dynamic Allotted Curriculum Preview */}
        {selectedClass && (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{selectedClass.name} — Sem {selectedClass.semester}</p>
                <p className="text-gray-500 text-[11px]">{branchName ?? 'Academic Division'}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-md font-medium border border-green-200">
                <CheckCircle2 size={12} /> Target Ready
              </span>
            </div>

            {allottedSubjects && allottedSubjects.length > 0 && (
              <div className="pt-2 border-t border-gray-200">
                <p className="font-semibold text-gray-700 flex items-center gap-1.5 mb-1.5">
                  <BookOpen size={13} className="text-blue-600" />
                  <span>Dynamic Allotted Subjects ({allottedSubjects.length})</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {allottedSubjects.map(s => (
                    <span
                      key={s.id}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-gray-200 text-gray-800 font-medium text-[11px] shadow-2xs"
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

        {/* Practical Batch Strategy */}
        <div className="space-y-2 pt-1">
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Practical Batch Distribution
          </label>

          <div className="space-y-2">
            <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer">
              <input
                type="radio"
                name="batchStrategy"
                value="auto"
                checked={batchStrategy === 'auto'}
                onChange={() => setBatchStrategy('auto')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs">
                <p className="font-semibold text-gray-900">
                  Auto-distribute evenly across batches
                </p>
                <p className="text-gray-500 text-[11px] mt-0.5">
                  Distributes selected students across available batches (e.g. Batch 1, Batch 2) in round-robin fashion.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer">
              <input
                type="radio"
                name="batchStrategy"
                value="specific"
                checked={batchStrategy === 'specific'}
                onChange={() => setBatchStrategy('specific')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs flex-1">
                <p className="font-semibold text-gray-900">
                  Assign all to a specific practical batch
                </p>
                {batchStrategy === 'specific' && (
                  <div className="mt-2">
                    <Select
                      placeholder="Choose batch..."
                      value={specificBatchId}
                      onChange={e => setSpecificBatchId(e.target.value)}
                      options={classBatches?.map(b => ({ value: b.id, label: b.name })) ?? []}
                    />
                  </div>
                )}
              </div>
            </label>

            <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer">
              <input
                type="radio"
                name="batchStrategy"
                value="none"
                checked={batchStrategy === 'none'}
                onChange={() => setBatchStrategy('none')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs">
                <p className="font-semibold text-gray-900">Whole Class Only (No Batch)</p>
                <p className="text-gray-500 text-[11px] mt-0.5">
                  Leaves practical batch unassigned for lecture-only or general attendance.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex gap-2 pt-3 border-t border-gray-100">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            loading={assignMutation.isPending}
            disabled={!classId || (batchStrategy === 'specific' && !specificBatchId)}
            onClick={() => assignMutation.mutate()}
          >
            Allot {selectedStudentIds.length} Student{selectedStudentIds.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
