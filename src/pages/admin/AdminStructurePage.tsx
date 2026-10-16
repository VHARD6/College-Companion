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
import type { SubjectType } from '../../types'

export default function AdminStructurePage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'departments' | 'classes' | 'batches' | 'subjects'>('departments')

  // Form states
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

  // Queries
  const { data: departments, isLoading: deptLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data } = await supabase.from('departments').select('*').order('name')
      return data ?? []
    },
  })

  const { data: classes, isLoading: classLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: async () => {
      const { data } = await supabase.from('classes').select('*, departments(name)').order('name')
      return data ?? []
    },
  })

  const { data: batches, isLoading: batchLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data } = await supabase.from('batches').select('*, classes(name)').order('name')
      return data ?? []
    },
  })

  const { data: subjects, isLoading: subjectLoading } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*, departments(name)').order('name')
      return data ?? []
    },
  })

  // Mutations
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
        {/* DEPARTMENTS TAB */}
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
                    <span className="font-medium text-gray-900 text-sm">{d.name}</span>
                    <Badge variant="gray">ID #{d.id}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CLASSES TAB */}
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
                    <Badge variant="blue">Sem {c.semester}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BATCHES TAB */}
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
                    <Badge variant="green">Batch</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SUBJECTS TAB */}
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
                    <Badge variant={s.type === 'practical' ? 'yellow' : 'blue'}>
                      {s.type}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
