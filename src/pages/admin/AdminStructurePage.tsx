import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import toast from 'react-hot-toast'
import { Pencil, Trash2, X } from 'lucide-react'
import type { SubjectType, Department, Class, Batch, Subject } from '../../types'

export default function AdminStructurePage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'departments' | 'classes' | 'batches' | 'subjects'>('departments')

  // Create Form States
  const [deptName, setDeptName] = useState('')

  const [className, setClassName] = useState('')
  const [classDeptId, setClassDeptId] = useState('')
  const [classSemester, setClassSemester] = useState('1')
  const [classAcademicYear, setClassAcademicYear] = useState('2024-25')

  const [batchClassId, setBatchClassId] = useState('')
  const [batchName, setBatchName] = useState('')

  const [subjectName, setSubjectName] = useState('')
  const [subjectCode, setSubjectCode] = useState('')
  const [subjectDeptId, setSubjectDeptId] = useState('')
  const [subjectSemester, setSubjectSemester] = useState('1')
  const [subjectType, setSubjectType] = useState<SubjectType>('theory')

  // Edit Modal States
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [editingClass, setEditingClass] = useState<Class | null>(null)
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null)
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null)

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: departments, isLoading: deptLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('departments').select('*').order('name')
      if (error) throw error
      return (data as Department[]) ?? []
    },
  })

  const { data: classes, isLoading: classLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, departments(name)').order('name')
      if (error) throw error
      return (data as Class[]) ?? []
    },
  })

  const { data: batches, isLoading: batchLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('batches').select('*, classes(name)').order('name')
      if (error) throw error
      return (data as Batch[]) ?? []
    },
  })

  const { data: subjects, isLoading: subjectLoading } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*, departments(name)').order('name')
      if (error) throw error
      return (data as Subject[]) ?? []
    },
  })

  // ─── Create Mutations ─────────────────────────────────────────────────────
  const addDeptMutation = useMutation({
    mutationFn: async () => {
      if (!deptName.trim()) throw new Error('Department name is required')
      const { error } = await supabase.from('departments').insert({ name: deptName.trim() })
      if (error) {
        if (error.code === '23505') throw new Error('A department with this name already exists.')
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Department created')
      setDeptName('')
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const addClassMutation = useMutation({
    mutationFn: async () => {
      if (!className.trim() || !classDeptId) throw new Error('Class name and department are required')
      const { error } = await supabase.from('classes').insert({
        name: className.trim(),
        department_id: Number(classDeptId),
        semester: Number(classSemester),
        academic_year: classAcademicYear.trim(),
      })
      if (error) {
        if (error.code === '23505') throw new Error('This class division already exists in this department.')
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Class division created')
      setClassName('')
      queryClient.invalidateQueries({ queryKey: ['classes'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const addBatchMutation = useMutation({
    mutationFn: async () => {
      if (!batchClassId || !batchName.trim()) throw new Error('Class and batch name are required')
      const { error } = await supabase.from('batches').insert({
        class_id: Number(batchClassId),
        name: batchName.trim(),
      })
      if (error) {
        if (error.code === '23505') throw new Error('A batch with this name already exists for this class.')
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Batch created')
      setBatchName('')
      queryClient.invalidateQueries({ queryKey: ['batches'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const addSubjectMutation = useMutation({
    mutationFn: async () => {
      if (!subjectName.trim() || !subjectCode.trim() || !subjectDeptId) {
        throw new Error('Name, code, and department are required')
      }
      const { error } = await supabase.from('subjects').insert({
        name: subjectName.trim(),
        code: subjectCode.trim().toUpperCase(),
        department_id: Number(subjectDeptId),
        semester: Number(subjectSemester),
        type: subjectType,
      })
      if (error) {
        if (error.code === '23505') throw new Error(`Subject code ${subjectCode.trim().toUpperCase()} is already in use.`)
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Subject created')
      setSubjectName('')
      setSubjectCode('')
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // ─── Update Mutations ─────────────────────────────────────────────────────
  const updateDeptMutation = useMutation({
    mutationFn: async () => {
      if (!editingDept || !editingDept.name.trim()) throw new Error('Department name is required')
      const { error } = await supabase
        .from('departments')
        .update({ name: editingDept.name.trim() })
        .eq('id', editingDept.id)
      if (error) {
        if (error.code === '23505') throw new Error('A department with this name already exists.')
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Department updated')
      setEditingDept(null)
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const updateClassMutation = useMutation({
    mutationFn: async () => {
      if (!editingClass || !editingClass.name.trim() || !editingClass.department_id) {
        throw new Error('Class name and department are required')
      }
      const { error } = await supabase
        .from('classes')
        .update({
          name: editingClass.name.trim(),
          department_id: Number(editingClass.department_id),
          semester: Number(editingClass.semester),
          academic_year: editingClass.academic_year.trim(),
        })
        .eq('id', editingClass.id)
      if (error) {
        if (error.code === '23505') throw new Error('A class with this name already exists in this department.')
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Class updated')
      setEditingClass(null)
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      queryClient.invalidateQueries({ queryKey: ['batches'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const updateBatchMutation = useMutation({
    mutationFn: async () => {
      if (!editingBatch || !editingBatch.name.trim() || !editingBatch.class_id) {
        throw new Error('Batch name and class are required')
      }
      const { error } = await supabase
        .from('batches')
        .update({
          name: editingBatch.name.trim(),
          class_id: Number(editingBatch.class_id),
        })
        .eq('id', editingBatch.id)
      if (error) {
        if (error.code === '23505') throw new Error('A batch with this name already exists for this class.')
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Batch updated')
      setEditingBatch(null)
      queryClient.invalidateQueries({ queryKey: ['batches'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const updateSubjectMutation = useMutation({
    mutationFn: async () => {
      if (!editingSubject || !editingSubject.name.trim() || !editingSubject.code.trim() || !editingSubject.department_id) {
        throw new Error('Subject name, code, and department are required')
      }
      const { error } = await supabase
        .from('subjects')
        .update({
          name: editingSubject.name.trim(),
          code: editingSubject.code.trim().toUpperCase(),
          department_id: Number(editingSubject.department_id),
          semester: Number(editingSubject.semester),
          type: editingSubject.type,
        })
        .eq('id', editingSubject.id)
      if (error) {
        if (error.code === '23505') throw new Error('Subject code is already in use by another subject.')
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Subject updated')
      setEditingSubject(null)
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // ─── Delete Mutations ─────────────────────────────────────────────────────
  const deleteDeptMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('departments').delete().eq('id', id)
      if (error) {
        if (error.code === '23503') {
          throw new Error('Cannot delete department: classes, subjects, or professors are currently assigned to it.')
        }
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Department deleted')
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const deleteClassMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('classes').delete().eq('id', id)
      if (error) {
        if (error.code === '23503') {
          throw new Error('Cannot delete class: batches, students, or teaching assignments are currently linked to it.')
        }
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Class deleted')
      queryClient.invalidateQueries({ queryKey: ['classes'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const deleteBatchMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('batches').delete().eq('id', id)
      if (error) {
        if (error.code === '23503') {
          throw new Error('Cannot delete batch: students or practical teaching assignments are linked to it.')
        }
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Batch deleted')
      queryClient.invalidateQueries({ queryKey: ['batches'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const deleteSubjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('subjects').delete().eq('id', id)
      if (error) {
        if (error.code === '23503') {
          throw new Error('Cannot delete subject: teaching assignments are mapped to it.')
        }
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Subject deleted')
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const tabs = [
    { key: 'departments', label: 'Departments' },
    { key: 'classes',     label: 'Classes' },
    { key: 'batches',     label: 'Batches' },
    { key: 'subjects',    label: 'Subjects' },
  ] as const

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <TopBar title="Academic Structure" showBack />

      {/* Tabs */}
      <div className="flex bg-white border-b border-gray-200 sticky top-[53px] z-10">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            className={`flex-1 py-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* ─── DEPARTMENTS TAB ─── */}
        {activeTab === 'departments' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-gray-900 text-sm">Add New Department</h3>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Computer Science & Engineering"
                  value={deptName}
                  onChange={e => setDeptName(e.target.value)}
                />
                <Button
                  loading={addDeptMutation.isPending}
                  onClick={() => addDeptMutation.mutate()}
                >
                  Add
                </Button>
              </div>
            </div>

            {deptLoading ? (
              <div className="flex justify-center py-8"><Spinner className="h-8 w-8" /></div>
            ) : departments?.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No departments yet</p>
            ) : (
              <div className="space-y-2">
                {departments?.map(d => (
                  <div key={d.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900 text-sm">{d.name}</span>
                      <span className="ml-2 text-xs text-gray-400 font-mono">#ID {d.id}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg transition-colors"
                        title="Edit Department"
                        onClick={() => setEditingDept({ ...d })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg transition-colors"
                        title="Delete Department"
                        onClick={() => {
                          if (window.confirm(`Delete department "${d.name}"?`)) {
                            deleteDeptMutation.mutate(d.id)
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── CLASSES TAB ─── */}
        {activeTab === 'classes' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-gray-900 text-sm">Add New Class / Division</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Division Name"
                  placeholder="e.g. CS-A"
                  value={className}
                  onChange={e => setClassName(e.target.value)}
                />
                <Select
                  label="Department"
                  placeholder="Select department..."
                  value={classDeptId}
                  onChange={e => setClassDeptId(e.target.value)}
                  options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Semester"
                  value={classSemester}
                  onChange={e => setClassSemester(e.target.value)}
                  options={[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ value: n, label: `Semester ${n}` }))}
                />
                <Input
                  label="Academic Year"
                  value={classAcademicYear}
                  onChange={e => setClassAcademicYear(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                loading={addClassMutation.isPending}
                onClick={() => addClassMutation.mutate()}
              >
                Create Class
              </Button>
            </div>

            {classLoading ? (
              <div className="flex justify-center py-8"><Spinner className="h-8 w-8" /></div>
            ) : classes?.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No classes created</p>
            ) : (
              <div className="space-y-2">
                {classes?.map(c => (
                  <div key={c.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {(c.departments as any)?.name} · Sem {c.semester} · {c.academic_year}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="blue">Sem {c.semester}</Badge>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg transition-colors"
                        title="Edit Class"
                        onClick={() => setEditingClass({ ...c })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg transition-colors"
                        title="Delete Class"
                        onClick={() => {
                          if (window.confirm(`Delete class division "${c.name}"?`)) {
                            deleteClassMutation.mutate(c.id)
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── BATCHES TAB ─── */}
        {activeTab === 'batches' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-gray-900 text-sm">Add Practical Batch</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Class"
                  placeholder="Select class..."
                  value={batchClassId}
                  onChange={e => setBatchClassId(e.target.value)}
                  options={classes?.map(c => ({ value: c.id, label: `${c.name} (Sem ${c.semester})` })) ?? []}
                />
                <Input
                  label="Batch Name"
                  placeholder="e.g. Batch 1"
                  value={batchName}
                  onChange={e => setBatchName(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                loading={addBatchMutation.isPending}
                onClick={() => addBatchMutation.mutate()}
              >
                Create Batch
              </Button>
            </div>

            {batchLoading ? (
              <div className="flex justify-center py-8"><Spinner className="h-8 w-8" /></div>
            ) : batches?.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No practical batches created</p>
            ) : (
              <div className="space-y-2">
                {batches?.map(b => (
                  <div key={b.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{b.name}</p>
                      <p className="text-xs text-gray-500">Class: {(b.classes as any)?.name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="green">Batch</Badge>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg transition-colors"
                        title="Edit Batch"
                        onClick={() => setEditingBatch({ ...b })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg transition-colors"
                        title="Delete Batch"
                        onClick={() => {
                          if (window.confirm(`Delete batch "${b.name}"?`)) {
                            deleteBatchMutation.mutate(b.id)
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── SUBJECTS TAB ─── */}
        {activeTab === 'subjects' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-gray-900 text-sm">Add New Subject</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Subject Name"
                  placeholder="e.g. Operating Systems"
                  value={subjectName}
                  onChange={e => setSubjectName(e.target.value)}
                />
                <Input
                  label="Subject Code"
                  placeholder="e.g. CS501"
                  value={subjectCode}
                  onChange={e => setSubjectCode(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select
                  label="Department"
                  placeholder="Select..."
                  value={subjectDeptId}
                  onChange={e => setSubjectDeptId(e.target.value)}
                  options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
                />
                <Select
                  label="Semester"
                  value={subjectSemester}
                  onChange={e => setSubjectSemester(e.target.value)}
                  options={[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ value: n, label: `Sem ${n}` }))}
                />
                <Select
                  label="Type"
                  value={subjectType}
                  onChange={e => setSubjectType(e.target.value as SubjectType)}
                  options={[
                    { value: 'theory', label: 'Theory' },
                    { value: 'practical', label: 'Practical' },
                    { value: 'tutorial', label: 'Tutorial' },
                  ]}
                />
              </div>
              <Button
                className="w-full"
                loading={addSubjectMutation.isPending}
                onClick={() => addSubjectMutation.mutate()}
              >
                Create Subject
              </Button>
            </div>

            {subjectLoading ? (
              <div className="flex justify-center py-8"><Spinner className="h-8 w-8" /></div>
            ) : subjects?.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No subjects created</p>
            ) : (
              <div className="space-y-2">
                {subjects?.map(s => (
                  <div key={s.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">
                        {s.name} <span className="font-mono text-gray-400 text-xs">({s.code})</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {(s.departments as any)?.name} · Sem {s.semester}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={s.type === 'practical' ? 'yellow' : 'blue'}>
                        {s.type}
                      </Badge>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg transition-colors"
                        title="Edit Subject"
                        onClick={() => setEditingSubject({ ...s })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg transition-colors"
                        title="Delete Subject"
                        onClick={() => {
                          if (window.confirm(`Delete subject "${s.name}" (${s.code})?`)) {
                            deleteSubjectMutation.mutate(s.id)
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── EDIT MODALS ─── */}

      {/* Edit Department Modal */}
      {editingDept && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">Edit Department</h3>
              <button onClick={() => setEditingDept(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <Input
              label="Department Name"
              value={editingDept.name}
              onChange={e => setEditingDept({ ...editingDept, name: e.target.value })}
            />
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingDept(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={updateDeptMutation.isPending}
                onClick={() => updateDeptMutation.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Class Modal */}
      {editingClass && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">Edit Class Division</h3>
              <button onClick={() => setEditingClass(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Division Name"
                value={editingClass.name}
                onChange={e => setEditingClass({ ...editingClass, name: e.target.value })}
              />
              <Select
                label="Department"
                value={editingClass.department_id}
                onChange={e => setEditingClass({ ...editingClass, department_id: Number(e.target.value) })}
                options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Semester"
                value={editingClass.semester}
                onChange={e => setEditingClass({ ...editingClass, semester: Number(e.target.value) })}
                options={[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ value: n, label: `Semester ${n}` }))}
              />
              <Input
                label="Academic Year"
                value={editingClass.academic_year}
                onChange={e => setEditingClass({ ...editingClass, academic_year: e.target.value })}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingClass(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={updateClassMutation.isPending}
                onClick={() => updateClassMutation.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Batch Modal */}
      {editingBatch && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">Edit Practical Batch</h3>
              <button onClick={() => setEditingBatch(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <Select
              label="Class"
              value={editingBatch.class_id}
              onChange={e => setEditingBatch({ ...editingBatch, class_id: Number(e.target.value) })}
              options={classes?.map(c => ({ value: c.id, label: `${c.name} (Sem ${c.semester})` })) ?? []}
            />
            <Input
              label="Batch Name"
              value={editingBatch.name}
              onChange={e => setEditingBatch({ ...editingBatch, name: e.target.value })}
            />
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingBatch(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={updateBatchMutation.isPending}
                onClick={() => updateBatchMutation.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Subject Modal */}
      {editingSubject && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">Edit Subject</h3>
              <button onClick={() => setEditingSubject(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Subject Name"
                value={editingSubject.name}
                onChange={e => setEditingSubject({ ...editingSubject, name: e.target.value })}
              />
              <Input
                label="Subject Code"
                value={editingSubject.code}
                onChange={e => setEditingSubject({ ...editingSubject, code: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select
                label="Department"
                value={editingSubject.department_id}
                onChange={e => setEditingSubject({ ...editingSubject, department_id: Number(e.target.value) })}
                options={departments?.map(d => ({ value: d.id, label: d.name })) ?? []}
              />
              <Select
                label="Semester"
                value={editingSubject.semester}
                onChange={e => setEditingSubject({ ...editingSubject, semester: Number(e.target.value) })}
                options={[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ value: n, label: `Sem ${n}` }))}
              />
              <Select
                label="Type"
                value={editingSubject.type}
                onChange={e => setEditingSubject({ ...editingSubject, type: e.target.value as SubjectType })}
                options={[
                  { value: 'theory', label: 'Theory' },
                  { value: 'practical', label: 'Practical' },
                  { value: 'tutorial', label: 'Tutorial' },
                ]}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingSubject(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={updateSubjectMutation.isPending}
                onClick={() => updateSubjectMutation.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
