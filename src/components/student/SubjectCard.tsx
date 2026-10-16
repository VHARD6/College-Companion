import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { useNavigate } from 'react-router-dom'
import type { SubjectAttendanceSummary } from '../../types'

interface Props {
  summary: SubjectAttendanceSummary
  threshold: number
}

export default function SubjectCard({ summary, threshold }: Props) {
  const navigate = useNavigate()
  const { subject, attended, held, percent, status } = summary

  const badgeVariant = {
    safe:    'green' as const,
    warning: 'yellow' as const,
    danger:  'red' as const,
  }[status]

  const barColor = {
    safe:    'bg-green-500',
    warning: 'bg-yellow-500',
    danger:  'bg-red-500',
  }[status]

  const displayPercent = percent !== null ? `${percent}%` : 'No classes yet'

  return (
    <Card
      onClick={() => navigate(`/student/subject/${subject.id}`)}
      className="hover:shadow-md"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-semibold text-gray-900">{subject.name}</p>
          <p className="text-xs text-gray-500">{subject.code} · {subject.type}</p>
        </div>
        <Badge variant={badgeVariant}>
          {status === 'danger' && '⚠ '}{displayPercent}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(percent ?? 0, 100)}%` }}
        />
      </div>

      {/* Threshold line marker */}
      <div className="relative h-0">
        <div
          className="absolute bottom-0 w-px h-4 bg-gray-400"
          style={{ left: `${threshold}%`, transform: 'translateY(-8px)' }}
          title={`${threshold}% threshold`}
        />
      </div>

      <p className="mt-2 text-xs text-gray-500">{attended} / {held} classes attended</p>

      {status === 'danger' && (
        <p className="mt-1 text-xs text-red-600 font-medium">
          ⚠ Below {threshold}% — attendance shortage
        </p>
      )}
    </Card>
  )
}
