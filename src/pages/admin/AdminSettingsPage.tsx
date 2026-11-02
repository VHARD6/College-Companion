import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/ui/TopBar'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import { Shield, ExternalLink } from 'lucide-react'

export default function AdminSettingsPage() {
  const queryClient = useQueryClient()
  const [threshold, setThreshold] = useState<number | ''>('')
  const [correctionHrs, setCorrectionHrs] = useState<number | ''>('')

  const { data: policy, isLoading } = useQuery({
    queryKey: ['policy'],
    queryFn: async () => {
      const { data } = await supabase.from('attendance_policy').select('*').single()
      if (data) {
        setThreshold(data.threshold_percent)
        setCorrectionHrs(data.correction_window_hrs)
      }
      return data
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('attendance_policy')
        .update({
          threshold_percent: Number(threshold),
          correction_window_hrs: Number(correctionHrs),
        })
        .eq('id', policy!.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy'] })
      toast.success('Policy updated!')
    },
    onError: (err: any) => toast.error(err.message),
  })

  return (
    <div>
      <TopBar title="Settings" showBack />
      <div className="p-4 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
        ) : (
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">Attendance Policy</h2>
            <div className="space-y-4">
              <Input
                label="Minimum Attendance Threshold (%)"
                type="number"
                min={1}
                max={100}
                value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
              />
              <Input
                label="Correction Window (hours)"
                type="number"
                min={1}
                value={correctionHrs}
                onChange={e => setCorrectionHrs(Number(e.target.value))}
              />
              <Button
                className="w-full"
                onClick={() => updateMutation.mutate()}
                loading={updateMutation.isPending}
              >
                Save Changes
              </Button>
            </div>
          </Card>
        )}

        {/* Academic structure link */}
        <StructureSummary />

        {/* Data Protection & Compliance Governance */}
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="text-blue-600" size={18} />
            <h2 className="font-semibold text-gray-900 text-sm">Data Protection &amp; Privacy Governance</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            Institutional compliance overview under the Digital Personal Data Protection Act (DPDP Act 2023), FERPA, and academic record confidentiality standards.
          </p>
          <Link
            to="/privacy"
            className="inline-flex items-center justify-between w-full p-2.5 rounded-xl border border-blue-100 bg-blue-50/60 hover:bg-blue-50 text-xs font-medium text-blue-700 transition-colors"
          >
            <span>View Institutional Privacy Notice &amp; DPO Details</span>
            <ExternalLink size={14} />
          </Link>
        </Card>
      </div>
    </div>
  )
}

function StructureSummary() {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['admin-structure-summary'],
    queryFn: async () => {
      const [
        { count: deptCount },
        { count: classCount },
        { count: subjectCount },
      ] = await Promise.all([
        supabase.from('departments').select('id', { count: 'exact', head: true }),
        supabase.from('classes').select('id', { count: 'exact', head: true }),
        supabase.from('subjects').select('id', { count: 'exact', head: true }),
      ])
      return { departments: deptCount ?? 0, classes: classCount ?? 0, subjects: subjectCount ?? 0 }
    },
  })

  return (
    <Card onClick={() => navigate('/admin/structure')} className="hover:shadow-md cursor-pointer transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">Academic Structure Summary</h2>
        <span className="text-xs text-blue-600 font-medium hover:underline inline-flex items-center gap-1">
          Manage <ExternalLink size={12} />
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-blue-600">{data?.departments ?? '--'}</p>
          <p className="text-xs text-gray-500">Departments</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-blue-600">{data?.classes ?? '--'}</p>
          <p className="text-xs text-gray-500">Classes</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-blue-600">{data?.subjects ?? '--'}</p>
          <p className="text-xs text-gray-500">Subjects</p>
        </div>
      </div>
    </Card>
  )
}
