import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import toast from 'react-hot-toast'
import { normalizeEmail, validateEmail, validatePassword } from '../../lib/authUtils'
import { parseCsvInput, evaluateCsvImportOutcome } from '../../lib/adminUtils'

interface ClassRef {
  id: number
  name: string
  semester?: number
}

interface CsvImportCardProps {
  isOpen: boolean
  classes: ClassRef[] | undefined
  onSuccess: () => void
  onClose: () => void
}

export default function CsvImportCard({
  isOpen,
  classes,
  onSuccess,
  onClose,
}: CsvImportCardProps) {
  const [csvText, setCsvText] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  if (!isOpen) return null

  async function handleCsvImport() {
    if (isImporting) return

    const parsed = parseCsvInput(csvText, 500)
    if (parsed.error) {
      toast.error(parsed.error)
      return
    }

    const { headers, rows } = parsed
    const nameIdx = headers.indexOf('name') !== -1 ? headers.indexOf('name') : 0
    const emailIdx = headers.indexOf('email') !== -1 ? headers.indexOf('email') : 1
    const passwordIdx = headers.indexOf('password') !== -1 ? headers.indexOf('password') : 2
    const rollIdx =
      headers.indexOf('roll_no') !== -1
        ? headers.indexOf('roll_no')
        : headers.indexOf('rollno') !== -1
          ? headers.indexOf('rollno')
          : 3
    const classIdx =
      headers.indexOf('class_name') !== -1
        ? headers.indexOf('class_name')
        : headers.indexOf('class') !== -1
          ? headers.indexOf('class')
          : 4
    const batchIdx =
      headers.indexOf('batch_name') !== -1
        ? headers.indexOf('batch_name')
        : headers.indexOf('batch') !== -1
          ? headers.indexOf('batch')
          : 5

    setIsImporting(true)
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < rows.length; i++) {
      const parts = rows[i]
      const name = parts[nameIdx]?.trim() || ''
      const email = parts[emailIdx]?.trim() || ''
      const password = parts[passwordIdx] || ''
      const rawRollNo = parts[rollIdx]?.trim() || ''
      const class_name = parts[classIdx]?.trim() || ''
      const batch_name = parts[batchIdx]?.trim() || ''

      // Sanitize roll number against null bytes and control chars
      // eslint-disable-next-line no-control-regex
      const roll_no = rawRollNo.replace(/[\0\x00-\x1F\x7F]/g, '').trim()

      if (!name || !email || !password || !roll_no || !class_name) {
        errorCount++
        continue
      }

      // Password security check
      const passCheck = validatePassword(password)
      if (!passCheck.isValid) {
        console.error(`Line ${i + 2}: ${passCheck.error}`)
        errorCount++
        continue
      }

      try {
        const targetClass = classes?.find(c => c.name.toLowerCase() === class_name.toLowerCase())
        if (!targetClass) {
          throw new Error(`Class ${class_name} not found`)
        }

        let targetBatchId: number | null = null
        if (batch_name) {
          const { data: bData, error: bErr } = await supabase
            .from('batches')
            .select('id')
            .eq('class_id', targetClass.id)
            .ilike('name', batch_name)
            .maybeSingle()
          if (!bErr && bData) targetBatchId = bData.id
        }

        const cleanEmail = normalizeEmail(email)
        const emailCheck = validateEmail(cleanEmail)
        if (!emailCheck.isValid) {
          throw new Error(`Line ${i + 2}: ${emailCheck.error}`)
        }

        // Provision via admin-create-user Edge Function
        const { data: funcData, error: funcError } = await supabase.functions.invoke('admin-create-user', {
          body: {
            name: name.trim(),
            email: cleanEmail,
            password,
            role: 'student',
            rollNo: roll_no.trim(),
            classId: String(targetClass.id),
            batchId: targetBatchId ? String(targetBatchId) : undefined,
          },
        })

        if (funcError || !funcData?.success) {
          let msg = funcError?.message || funcData?.error || 'Failed to create student'
          if (msg.includes('non-2xx') || msg.includes('404') || (funcError as any)?.context?.status === 404) {
            msg = "Edge Function 'admin-create-user' is not deployed (HTTP 404). Deploy with 'supabase functions deploy admin-create-user'."
          }
          throw new Error(msg)
        }

        successCount++
      } catch (e) {
        console.error('Import error on line', i + 2, e)
        errorCount++
      }
    }

    setIsImporting(false)
    const outcome = evaluateCsvImportOutcome(successCount, errorCount)

    if (successCount > 0) {
      onSuccess()
    }

    if (outcome.shouldCloseModal) {
      onClose()
    }
    if (outcome.shouldClearInput) {
      setCsvText('')
    }

    if (outcome.status === 'success') {
      toast.success(outcome.message)
    } else {
      toast.error(outcome.message)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900 text-sm">Bulk Import Students via CSV</h3>
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => {
            const firstClass = classes?.[0]?.name ?? 'CS-A'
            setCsvText(
              `name,email,password,roll_no,class_name,batch_name\nAakash Sharma,aakash@gmail.com,Pass1234,CS001,${firstClass},Batch 1\nBhavna Patel,bhavna@gmail.com,Pass1234,CS002,${firstClass},Batch 1\nChirag Verma,chirag@gmail.com,Pass1234,CS003,${firstClass},Batch 2`
            )
          }}
        >
          Fill Sample Data
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Format: <code>name,email,password,roll_no,class_name,batch_name</code>. The header row is required.
      </p>

      <textarea
        className="w-full font-mono text-xs border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        rows={6}
        placeholder="name,email,password,roll_no,class_name,batch_name"
        value={csvText}
        onChange={e => setCsvText(e.target.value)}
      />

      <Button
        className="w-full"
        loading={isImporting}
        onClick={handleCsvImport}
      >
        Start Import
      </Button>
    </div>
  )
}
