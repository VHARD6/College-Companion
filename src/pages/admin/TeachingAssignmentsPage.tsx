import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'

export default function TeachingAssignmentsPage() {
  const queryClient = useQueryClient()
  const [professorId, setProfessorId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [classId, setClassId] = useState('')
  const [batchId, setBatchId] = useState('')

  // Queries
  const {
    data: professors,
    isError: isProfsError,
  } = useQuery({
    queryKey: ['professors-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('professors')
        .select('id, profiles(name), departments(name)')
        .order('id')
      if (error) throw error
      return data ?? []
    },
  })

  const {
    data: subjects,
    isError: isSubjError,
  } = useQuery({
    queryKey: ['subjects-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const {
    data: classes,
    isError: isClassesError,
  } = useQuery({
    queryKey: ['classes-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, departments(name)').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: batches } = useQuery({
    queryKey: ['batches-for-class', classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase.from('batches').select('*').eq('class_id', Number(classId))
      if (error) throw error
      return data ?? []
    },
  })

  const {
    data: assignments,
    isLoading,
    isError: isAssignmentsError,
    refetch: refetchAssignments,
  } = useQuery({
    queryKey: ['teaching-assignments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teaching_assignments')
        .select(`
          id,
          professors(id, profiles(name)),
          subjects(name, code, type),
          classes(name, semester),
          batches(name)
        `)
        .order('id', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  // Add Assignment Mutation
  const addAssignmentMutation = useMutation({
    mutationFn: async () => {
      if (!professorId || !subjectId || !classId) {
        throw new Error('Professor, subject, and class are required.')
      }

      // Pre-check for duplicate assignment
      let dupQuery = supabase
        .from('teaching_assignments')
        .select('id')
        .eq('professor_id', Number(professorId))
        .eq('subject_id', Number(subjectId))
        .eq('class_id', Number(classId))

      if (batchId) {
        dupQuery = dupQuery.eq('batch_id', Number(batchId))
      } else {
        dupQuery = dupQuery.is('batch_id', null)
      }

      const { data: existing, error: dupCheckError } = await dupQuery.maybeSingle()
      if (dupCheckError) throw dupCheckError
      if (existing) {
        throw new Error('This professor is already assigned to this subject and class.')
      }

      const { data: inserted, error } = await supabase
        .from('teaching_assignments')
        .insert({
          professor_id: Number(professorId),
          subject_id: Number(subjectId),
          class_id: Number(classId),
          batch_id: batchId ? Number(batchId) : null,
        })
        .select('id')

      if (error) {
        if (error.code === '23505') {
          throw new Error('This teaching assignment already exists.')
        }
        throw error
      }
      if (!inserted || inserted.length === 0) {
        throw new Error('Failed to create teaching assignment. Database returned 0 rows.')
      }
      return inserted[0]
    },
    onSuccess: () => {
      toast.success('Teaching assignment created!')
      setBatchId('')
      queryClient.invalidateQueries({ queryKey: ['teaching-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['assignments-for-timetable'] })
      queryClient.invalidateQueries({ queryKey: ['professor-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['professor-all-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['professor-today-slots'] })
      queryClient.invalidateQueries({ queryKey: ['today-slots'] })
      queryClient.invalidateQueries({ queryKey: ['draft-sessions'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Delete Assignment Mutation
  const deleteAssignmentMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data: deleted, error } = await supabase
        .from('teaching_assignments')
        .delete()
        .eq('id', id)
        .select('id')

      if (error) throw error
      if (!deleted || deleted.length === 0) {
        throw new Error('Assignment could not be deleted or was already removed.')
      }
    },
    onSuccess: () => {
      toast.success('Assignment removed')
      queryClient.invalidateQueries({ queryKey: ['teaching-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['assignments-for-timetable'] })
      queryClient.invalidateQueries({ queryKey: ['professor-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['professor-all-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['professor-today-slots'] })
      queryClient.invalidateQueries({ queryKey: ['today-slots'] })
      queryClient.invalidateQueries({ queryKey: ['draft-sessions'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const getProfName = (profObj: any) => {
    if (!profObj) return 'Unknown'
    const profiles = Array.isArray(profObj.profiles) ? profObj.profiles[0] : profObj.profiles
    return profiles?.name ?? 'Unknown'
  }

  const getDeptName = (deptObj: any) => {
    if (!deptObj) return 'General'
    const depts = Array.isArray(deptObj.departments) ? deptObj.departments[0] : deptObj.departments
    return depts?.name ?? 'General'
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <TopBar title="Teaching Assignments" showBack />

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Guidance and Error States */}
        {professors && professors.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 space-y-1">
            <p className="font-semibold text-amber-900">No professors assigned to departments yet</p>
            <p>
              Before assigning subjects, make sure professors are assigned to a department in the{' '}
              <a href="/admin/users" className="underline font-medium text-blue-700">User Management</a>{' '}
              page.
            </p>
          </div>
        )}

        {(isProfsError || isSubjError || isClassesError || isAssignmentsError) && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-700 flex items-center justify-between">
            <span>Failed to load some academic structure data.</span>
            <Button size="sm" variant="outline" onClick={() => refetchAssignments()}>Retry</Button>
          </div>
        )}

        {/* Create Assignment Form */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-900 text-sm">Assign Professor to Class</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Professor"
              placeholder="Select professor..."
              value={professorId}
              onChange={e => setProfessorId(e.target.value)}
              options={professors?.map(p => ({
                value: p.id,
                label: `Prof. ${getProfName(p)} (${getDeptName(p)})`,
              })) ?? []}
            />

            <Select
              label="Subject"
              placeholder="Select subject..."
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
              options={subjects?.map(s => ({
                value: s.id,
                label: `${s.name} (${s.code} · ${s.type})`,
              })) ?? []}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Class / Division"
              placeholder="Select class..."
              value={classId}
              onChange={e => {
                setClassId(e.target.value)
                setBatchId('')
              }}
              options={classes?.map(c => ({
                value: c.id,
                label: `${c.name} (Sem ${c.semester})`,
              })) ?? []}
            />

            {batches && batches.length > 0 && (
              <Select
                label="Batch (Optional for practicals)"
                placeholder="All students (Theory)"
                value={batchId}
                onChange={e => setBatchId(e.target.value)}
                options={batches.map(b => ({ value: b.id, label: b.name }))}
              />
            )}
          </div>

          <Button
            className="w-full"
            loading={addAssignmentMutation.isPending}
            disabled={addAssignmentMutation.isPending || !professorId || !subjectId || !classId}
            onClick={() => {
              if (addAssignmentMutation.isPending || !professorId || !subjectId || !classId) return
              addAssignmentMutation.mutate()
            }}
          >
            Create Assignment
          </Button>
        </div>

        {/* Existing Assignments List */}
        <div>
          <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide mb-3">
            Active Assignments ({assignments?.length ?? 0})
          </h3>

          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
          ) : assignments?.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">No teaching assignments mapped yet</p>
          ) : (
            <div className="space-y-2">
              {assignments?.map(a => {
                const prof = getProfName(a.professors)
                const subj = a.subjects as any
                const cls = a.classes as any
                const batch = a.batches as any

                return (
                  <div
                    key={a.id}
                    className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between shadow-2xs hover:border-gray-300 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-gray-900 text-sm">
                        {subj?.name} <span className="font-mono text-xs text-gray-400">({subj?.code})</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Class: {cls?.name} (Sem {cls?.semester}) {batch ? `· ${batch.name}` : '· Full Class'}
                      </p>
                      <p className="text-xs text-blue-600 font-medium mt-0.5">Prof. {prof}</p>
                    </div>

                    <button
                      type="button"
                      className="text-gray-400 hover:text-red-600 p-2 rounded-lg transition-colors"
                      title="Remove assignment"
                      onClick={() => {
                        if (window.confirm(`Remove assignment for ${subj?.name} (${cls?.name})?`)) {
                          deleteAssignmentMutation.mutate(a.id)
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
