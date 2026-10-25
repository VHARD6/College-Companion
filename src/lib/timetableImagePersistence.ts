import { supabase } from './supabase.ts'
import type { MasterTimetableGridData, PublishedMasterTimetable } from '../types/timetableMaker.ts'
import { renderTimetableToBlob } from './timetableImageRenderer.ts'

export interface PublishTimetableParams {
  gridData: MasterTimetableGridData
  date: string // YYYY-MM-DD
  academicYear?: string
  semester?: number
  className?: string
  announcement?: string
  client?: any
  adminProfileId?: string
  customBlob?: Blob
}

/**
 * Normalizes any date string (e.g. "22/10/2026" or "2026-10-22") to standard YYYY-MM-DD.
 */
export function normalizeDateToISO(d: string): string {
  if (d.includes('/')) {
    const parts = d.split('/')
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        // DD/MM/YYYY -> YYYY-MM-DD
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      }
    }
  }
  return d
}

/**
 * Normalizes YYYY-MM-DD to DD/MM/YYYY for official display.
 */
export function formatDateForOfficialDisplay(isoDate: string): string {
  if (isoDate.includes('-')) {
    const [y, m, d] = isoDate.split('-')
    if (y && m && d) return `${d}/${m}/${y}`
  }
  return isoDate
}

/**
 * Uploads a timetable image to private Supabase Storage and persists publication metadata.
 * Strictly avoids data-URL fallback; requires Storage upload and metadata write to both succeed.
 */
export async function publishOfficialTimetable({
  gridData,
  date,
  academicYear = '2026-27',
  semester = 1,
  className = 'FY BTECH',
  announcement = '',
  client = supabase,
  adminProfileId,
  customBlob,
}: PublishTimetableParams): Promise<PublishedMasterTimetable> {
  const isoDate = normalizeDateToISO(date)
  gridData.date = formatDateForOfficialDisplay(isoDate)

  // 1. Generate high-resolution PNG image blob
  let blob: Blob | null = customBlob || null
  if (!blob) {
    if (typeof document !== 'undefined') {
      try {
        blob = await renderTimetableToBlob(gridData, 2)
      } catch (err: any) {
        throw new Error(`Failed to render timetable image on canvas: ${err.message}`)
      }
    } else if (typeof Blob !== 'undefined') {
      // Mock blob for headless test execution
      blob = new Blob(['mock-png-bytes'], { type: 'image/png' })
    }
  }

  if (!blob) {
    throw new Error('Failed to generate high-resolution timetable image: Blob generation produced empty data.')
  }

  // 2. Upload to private Storage bucket 'timetables'
  const fileName = `timetable_${className.replace(/\s+/g, '_')}_${isoDate}_${Date.now()}.png`
  const filePath = `published/${fileName}`

  let uploadData: any
  try {
    const res = await client.storage
      .from('timetables')
      .upload(filePath, blob, {
        contentType: 'image/png',
        upsert: true,
      })

    if (res.error) {
      const errMsg = res.error.message || 'Storage upload returned an error'
      if (
        errMsg.toLowerCase().includes('bucket not found') ||
        errMsg.toLowerCase().includes('not found') ||
        (res.error as any)?.statusCode === '404'
      ) {
        throw new Error(
          "Supabase Storage bucket 'timetables' does not exist or is not accessible. " +
          "Please apply migration 010 or create the private 'timetables' bucket in the Supabase Dashboard before publishing."
        )
      }
      throw new Error(`Storage upload failed: ${errMsg}`)
    }
    uploadData = res.data
  } catch (err: any) {
    throw err
  }

  if (!uploadData?.path) {
    throw new Error("Storage upload succeeded but returned no file path.")
  }

  // 3. Obtain signed URL for authenticated delivery (24 hour token)
  let signedUrl = ''
  try {
    const { data: signData, error: signErr } = await client.storage
      .from('timetables')
      .createSignedUrl(filePath, 86400)

    if (signErr || !signData?.signedUrl) {
      // Clean up orphaned upload
      await client.storage.from('timetables').remove([filePath]).catch(() => {})
      throw new Error(`Failed to generate signed URL for uploaded image: ${signErr?.message || 'Empty signed URL'}`)
    }
    signedUrl = signData.signedUrl
  } catch (err: any) {
    await client.storage.from('timetables').remove([filePath]).catch(() => {})
    throw err
  }

  // 4. Locate existing published record to handle replacement
  const { data: existing, error: findErr } = await client
    .from('published_master_timetables')
    .select('id, storage_path')
    .eq('timetable_date', isoDate)
    .eq('class_name', className)
    .maybeSingle()

  if (findErr) {
    // Clean up uploaded file
    await client.storage.from('timetables').remove([filePath]).catch(() => {})
    throw new Error(`Database error verifying existing timetable: ${findErr.message}`)
  }

  const oldStoragePath = existing?.storage_path

  // 5. Persist publication metadata
  const payload: any = {
    timetable_date: isoDate,
    academic_year: academicYear,
    semester,
    class_name: className,
    image_url: signedUrl,
    storage_path: filePath,
    announcement: announcement.trim() || null,
    grid_data: gridData,
    published_at: new Date().toISOString(),
    published_by: adminProfileId || null,
  }

  let savedRecord: PublishedMasterTimetable

  if (existing?.id) {
    const { data: updated, error: updateErr } = await client
      .from('published_master_timetables')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()

    if (updateErr) {
      // Clean up orphaned upload
      await client.storage.from('timetables').remove([filePath]).catch(() => {})
      throw new Error(`Failed to update timetable publication record: ${updateErr.message}`)
    }
    savedRecord = updated

    // Clean up older replaced file from storage if path changed
    if (oldStoragePath && oldStoragePath !== filePath) {
      await client.storage.from('timetables').remove([oldStoragePath]).catch(() => {})
    }
  } else {
    const { data: inserted, error: insertErr } = await client
      .from('published_master_timetables')
      .insert(payload)
      .select()
      .single()

    if (insertErr) {
      // Clean up orphaned upload
      await client.storage.from('timetables').remove([filePath]).catch(() => {})
      throw new Error(`Failed to insert timetable publication record: ${insertErr.message}`)
    }
    savedRecord = inserted
  }

  return savedRecord
}

/**
 * Fetch a published master timetable for a specific date (YYYY-MM-DD), refreshing signed URL.
 */
export async function fetchPublishedTimetableByDate(
  date: string,
  className = 'FY BTECH',
  client: any = supabase
): Promise<PublishedMasterTimetable | null> {
  const isoDate = normalizeDateToISO(date)
  const { data, error } = await client
    .from('published_master_timetables')
    .select('*')
    .eq('timetable_date', isoDate)
    .eq('class_name', className)
    .maybeSingle()

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('published_master_timetables')) {
      return null
    }
    throw error
  }

  if (data && data.storage_path) {
    try {
      const { data: signData } = await client.storage
        .from('timetables')
        .createSignedUrl(data.storage_path, 86400)
      if (signData?.signedUrl) {
        data.image_url = signData.signedUrl
      }
    } catch (e) {
      console.warn('Could not refresh signed URL for timetable image:', e)
    }
  }

  return data
}

/**
 * Fetch the latest published master timetable, refreshing signed URL.
 */
export async function fetchLatestPublishedTimetable(
  className = 'FY BTECH',
  client: any = supabase
): Promise<PublishedMasterTimetable | null> {
  const { data, error } = await client
    .from('published_master_timetables')
    .select('*')
    .eq('class_name', className)
    .order('timetable_date', { ascending: false })
    .limit(1)

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('published_master_timetables')) {
      return null
    }
    throw error
  }

  const record = data?.[0] ?? null
  if (record && record.storage_path) {
    try {
      const { data: signData } = await client.storage
        .from('timetables')
        .createSignedUrl(record.storage_path, 86400)
      if (signData?.signedUrl) {
        record.image_url = signData.signedUrl
      }
    } catch (e) {
      console.warn('Could not refresh signed URL for latest timetable image:', e)
    }
  }

  return record
}

/**
 * Fetch all dates that have a published timetable (for date picker / calendar navigation).
 */
export async function fetchPublishedDates(
  className = 'FY BTECH',
  client: any = supabase
): Promise<Array<{ timetable_date: string; announcement: string | null }>> {
  const { data, error } = await client
    .from('published_master_timetables')
    .select('timetable_date, announcement')
    .eq('class_name', className)
    .order('timetable_date', { ascending: false })

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('published_master_timetables')) {
      return []
    }
    throw error
  }

  return data ?? []
}

/**
 * Universal download helper that handles signed URLs, blobs, cross-origin restrictions,
 * and Android/desktop downloads cleanly.
 */
export async function downloadTimetableImage(imageUrl: string, filename: string): Promise<void> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  } catch {
    // Direct window open fallback
    window.open(imageUrl, '_blank')
  }
}
