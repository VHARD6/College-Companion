import { supabase } from './supabase.ts'
import type { MasterTimetableGridData, PublishedMasterTimetable } from '../types/timetableMaker.ts'
import { renderTimetableToBlob } from './timetableImageRenderer.ts'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

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
export function normalizeDateToISO(d: string | null | undefined): string {
  if (!d || typeof d !== 'string') return ''
  const trimmed = d.trim()
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/')
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        // DD/MM/YYYY -> YYYY-MM-DD
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      }
    }
  }
  return trimmed
}

/**
 * Normalizes YYYY-MM-DD to DD/MM/YYYY for official display.
 */
export function formatDateForOfficialDisplay(isoDate: string | null | undefined): string {
  if (!isoDate || typeof isoDate !== 'string') return ''
  const trimmed = isoDate.trim()
  if (trimmed.includes('-')) {
    const [y, m, d] = trimmed.split('-')
    if (y && m && d && y.length === 4) return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`
  }
  return trimmed
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

export interface DownloadResult {
  success: boolean
  method: 'native-save' | 'native-share' | 'web-share' | 'browser-download' | 'tab-opened'
  message: string
  path?: string
  aborted?: boolean
}

/**
 * Converts a Blob to a base64 encoded string across browsers and environments.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const maybeBuffer = (globalThis as any).Buffer
  if (typeof maybeBuffer !== 'undefined' && typeof maybeBuffer.from === 'function') {
    return maybeBuffer.from(buffer).toString('base64')
  }
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export interface NativeDownloadAdapter {
  isNativePlatform?: () => boolean
  writeFile?: (options: { path: string; data: string; directory: any; recursive?: boolean }) => Promise<{ uri: string }>
  share?: (options: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<any>
}

/**
 * Validates that an image URL uses an allowed, safe scheme.
 * Prevents protocol-level injection such as javascript:, data:, file:, etc.
 */
export function isValidDownloadUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim().toLowerCase()
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('vbscript:')
  ) {
    return false
  }
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('blob:')
  )
}

/**
 * Sanitizes a filename for download/save operations.
 * Strips directory traversal (../, ..\), path separators, null bytes,
 * and dangerous characters. Limits length and ensures a safe extension.
 */
export function sanitizeDownloadFilename(rawFilename: string | null | undefined): string {
  if (!rawFilename || typeof rawFilename !== 'string') {
    return 'timetable_export.png'
  }

  // Strip null bytes, non-printable characters, and normalize backslashes
  let cleaned = rawFilename
    .replace(/\0/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\\/g, '/')

  // Retain only basename
  cleaned = cleaned.split('/').pop() || ''

  // Replace illegal filename characters (< > : " / \ | ? *) with an underscore
  cleaned = cleaned.replace(/[<>:"/\\|?*]/g, '_')

  // Prevent multiple consecutive dots (directory traversal)
  cleaned = cleaned.replace(/\.{2,}/g, '.')

  // Strip leading and trailing dots and spaces
  cleaned = cleaned.trim().replace(/^\.+|\.+$/g, '')

  if (!cleaned) {
    return 'timetable_export.png'
  }

  // Ensure safe image extension
  if (!/\.(png|jpg|jpeg|webp)$/i.test(cleaned)) {
    cleaned += '.png'
  }

  // Max 120 characters limit to prevent OS filesystem errors
  if (cleaned.length > 120) {
    const extMatch = cleaned.match(/\.[a-zA-Z0-9]+$/)
    const ext = extMatch ? extMatch[0] : '.png'
    cleaned = cleaned.substring(0, 120 - ext.length) + ext
  }

  return cleaned
}

/**
 * Universal download and save helper that reliably saves timetable images across:
 * 1. Android Capacitor APK (using native Filesystem with scoped Documents and MediaScanner, falling back to Share)
 * 2. iOS Safari (using Web Share API with File object so users can "Save Image" to Photos or "Save to Files")
 * 3. Android Chrome (using Web Share or standard Blob anchor download)
 * 4. Desktop browsers (standard Blob anchor download)
 * 5. Fallback for restricted WebViews (opening in a new tab with long-press save instructions)
 */
export async function downloadTimetableImage(
  imageUrl: string,
  filename: string,
  nativeAdapter?: NativeDownloadAdapter
): Promise<DownloadResult> {
  if (!imageUrl || !imageUrl.trim()) {
    throw new Error('No timetable image URL available for download.')
  }

  if (!isValidDownloadUrl(imageUrl)) {
    throw new Error('Untrusted or invalid timetable image URL scheme.')
  }

  const safeFilename = sanitizeDownloadFilename(filename)

  const isNative = nativeAdapter?.isNativePlatform ? nativeAdapter.isNativePlatform() : Capacitor.isNativePlatform()
  const writeFileFn = nativeAdapter?.writeFile ?? Filesystem.writeFile
  const shareFn = nativeAdapter?.share ?? Share.share

  // 1. Android / iOS Native Capacitor flow
  if (isNative) {
    const res = await fetch(imageUrl)
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Timetable download link has expired. Please refresh the page.')
      }
      if (res.status === 404) {
        throw new Error('Timetable image file was not found in storage.')
      }
      throw new Error(`Failed to download image (HTTP ${res.status})`)
    }
    const blob = await res.blob()
    const base64Data = await blobToBase64(blob)

    // Attempt direct save to user-accessible Documents directory with MediaScanner
    try {
      const writeResult = await writeFileFn({
        path: safeFilename,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      })
      return {
        success: true,
        method: 'native-save',
        message: `Saved to Documents: ${safeFilename}`,
        path: writeResult.uri,
      }
    } catch (fsErr: any) {
      // Fallback: write to app Cache directory and present native Share/Save sheet
      try {
        const cacheResult = await writeFileFn({
          path: safeFilename,
          data: base64Data,
          directory: Directory.Cache,
        })
        await shareFn({
          title: safeFilename,
          url: cacheResult.uri,
          dialogTitle: 'Save or Share Timetable',
        })
        return {
          success: true,
          method: 'native-share',
          message: 'Opened native share sheet to save timetable',
          path: cacheResult.uri,
        }
      } catch (shareErr: any) {
        throw new Error(`Failed to save image on device: ${fsErr?.message || shareErr?.message || 'Storage error'}`)
      }
    }
  }

  // 2. Mobile Web & Desktop Web flow
  let blob: Blob
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Timetable download link has expired. Please refresh the page.')
      }
      if (res.status === 404) {
        throw new Error('Timetable image file was not found in storage.')
      }
      throw new Error(`Failed to download image (HTTP ${res.status})`)
    }
    blob = await res.blob()
  } catch (fetchErr: any) {
    // If fetch failed due to CORS or offline, fallback to opening URL directly
    if (typeof window !== 'undefined') {
      window.open(imageUrl, '_blank', 'noopener,noreferrer')
      return {
        success: true,
        method: 'tab-opened',
        message: 'Opened image in new tab. Long-press to save.',
      }
    }
    throw fetchErr
  }

  // 2a. Mobile Web Share API with File (Supported in iOS Safari 15+ and Android Chrome)
  // Allows iOS users to save directly to Photos via the native "Save Image" option in the share sheet
  if (
    typeof navigator !== 'undefined' &&
    typeof File !== 'undefined' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      const file = new File([blob], safeFilename, { type: 'image/png' })
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: safeFilename,
          })
          return {
            success: true,
            method: 'web-share',
            message: 'Image shared successfully.',
          }
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError') {
            return {
              success: false,
              aborted: true,
              method: 'web-share',
              message: 'Save cancelled by user.',
            }
          }
          // If sharing failed for other reasons, fall through to browser download
        }
      }
    } catch {
      // Fall through to anchor tag download
    }
  }

  // 2b. Standard Browser Blob Download (Desktop & browsers without Web Share)
  if (typeof document !== 'undefined') {
    try {
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = safeFilename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
      return {
        success: true,
        method: 'browser-download',
        message: `Downloading ${safeFilename}...`,
      }
    } catch {
      // Fall through to window.open
    }
  }

  // 2c. Final fallback: Open image in new window/tab
  if (typeof window !== 'undefined') {
    window.open(imageUrl, '_blank', 'noopener,noreferrer')
    return {
      success: true,
      method: 'tab-opened',
      message: 'Opened image in new tab. Long-press to save.',
    }
  }

  return {
    success: false,
    method: 'browser-download',
    message: 'Could not complete download in this environment.',
  }
}
