import type { TimetableValidationResult } from '../../types/timetableStudio'
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Props {
  validation: TimetableValidationResult
  onDismiss?: () => void
}

export default function TimetableConflictList({ validation, onDismiss }: Props) {
  const { isValid, errors, warnings } = validation

  if (isValid && warnings.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-emerald-600" />
          <span className="text-sm font-medium text-emerald-900">
            Timetable is valid and conflict-free! Ready to preview or publish.
          </span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold"
          >
            Dismiss
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={18} className="text-rose-600 shrink-0" />
            <h4 className="text-sm font-semibold text-rose-900">
              {errors.length} Blocking Conflict{errors.length > 1 ? 's' : ''} (Must resolve before publishing)
            </h4>
          </div>
          <ul className="space-y-1.5 ml-6 list-disc text-xs text-rose-800">
            {errors.map((err, idx) => (
              <li key={`err-${idx}`}>
                <span className="font-mono font-bold text-[11px] bg-rose-100 px-1 py-0.5 rounded mr-1.5">
                  {err.code}
                </span>
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-amber-600 shrink-0" />
            <h4 className="text-sm font-semibold text-amber-900">
              {warnings.length} Advisory Warning{warnings.length > 1 ? 's' : ''}
            </h4>
          </div>
          <ul className="space-y-1.5 ml-6 list-disc text-xs text-amber-800">
            {warnings.map((warn, idx) => (
              <li key={`warn-${idx}`}>
                <span className="font-mono font-bold text-[11px] bg-amber-100 px-1 py-0.5 rounded mr-1.5">
                  {warn.code}
                </span>
                {warn.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
