import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  blobToBase64,
  downloadTimetableImage,
} from '../src/lib/timetableImagePersistence.ts'
import { Directory } from '@capacitor/filesystem'

describe('Timetable Download & Persistence Suite', () => {
  const originalFetch = globalThis.fetch
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalDocument = (globalThis as any).document
  const originalWindow = (globalThis as any).window

  function setMockNavigator(mock: any) {
    Object.defineProperty(globalThis, 'navigator', {
      value: mock,
      configurable: true,
      writable: true,
    })
  }

  function restoreNavigator() {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator)
    } else {
      delete (globalThis as any).navigator
    }
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreNavigator()
    ;(globalThis as any).document = originalDocument
    ;(globalThis as any).window = originalWindow
  })

  describe('blobToBase64', () => {
    it('converts a text blob into standard base64 string', async () => {
      const text = 'Hello Timetable World!'
      const blob = new Blob([text], { type: 'text/plain' })
      const b64 = await blobToBase64(blob)
      assert.equal(b64, Buffer.from(text).toString('base64'))
    })

    it('converts a binary buffer blob into base64', async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // PNG header
      const blob = new Blob([bytes], { type: 'image/png' })
      const b64 = await blobToBase64(blob)
      assert.equal(b64, Buffer.from(bytes).toString('base64'))
    })
  })

  describe('downloadTimetableImage - Validation & Error Handling', () => {
    it('throws error when imageUrl is empty', async () => {
      await assert.rejects(
        () => downloadTimetableImage('', 'timetable.png'),
        { message: 'No timetable image URL available for download.' }
      )
    })

    it('throws explicit error when signed URL has expired (HTTP 401 / 403)', async () => {
      globalThis.fetch = async () =>
        new Response(null, { status: 403, statusText: 'Forbidden' })

      await assert.rejects(
        () => downloadTimetableImage('https://supabase.co/expired.png', 'timetable.png'),
        { message: 'Timetable download link has expired. Please refresh the page.' }
      )
    })

    it('throws explicit error when file is missing in storage (HTTP 404)', async () => {
      globalThis.fetch = async () =>
        new Response(null, { status: 404, statusText: 'Not Found' })

      await assert.rejects(
        () => downloadTimetableImage('https://supabase.co/notfound.png', 'timetable.png'),
        { message: 'Timetable image file was not found in storage.' }
      )
    })

    it('throws HTTP status error on unexpected server failure (HTTP 500)', async () => {
      globalThis.fetch = async () =>
        new Response(null, { status: 500, statusText: 'Internal Server Error' })

      await assert.rejects(
        () => downloadTimetableImage('https://supabase.co/error.png', 'timetable.png'),
        { message: 'Failed to download image (HTTP 500)' }
      )
    })
  })

  describe('downloadTimetableImage - Web Share API (Mobile Web)', () => {
    it('shares image file successfully via Web Share API when canShare is true', async () => {
      const mockBlob = new Blob(['fake-image-bytes'], { type: 'image/png' })
      globalThis.fetch = async () =>
        new Response(mockBlob, { status: 200 })

      let sharedPayload: any = null
      setMockNavigator({
        canShare: (_data: any) => true,
        share: async (payload: any) => {
          sharedPayload = payload
        },
      })

      const result = await downloadTimetableImage('https://supabase.co/valid.png', 'Timetable_2026-10-26.png')
      assert.equal(result.success, true)
      assert.equal(result.method, 'web-share')
      assert.equal(result.message, 'Image shared successfully.')
      assert.ok(sharedPayload)
      assert.equal(sharedPayload.title, 'Timetable_2026-10-26.png')
      assert.equal(sharedPayload.files.length, 1)
      assert.equal(sharedPayload.files[0].name, 'Timetable_2026-10-26.png')
    })

    it('handles user cancellation (AbortError) without reporting failure', async () => {
      const mockBlob = new Blob(['fake-image-bytes'], { type: 'image/png' })
      globalThis.fetch = async () =>
        new Response(mockBlob, { status: 200 })

      setMockNavigator({
        canShare: () => true,
        share: async () => {
          const err = new Error('Share canceled by user')
          err.name = 'AbortError'
          throw err
        },
      })

      const result = await downloadTimetableImage('https://supabase.co/valid.png', 'Timetable.png')
      assert.equal(result.success, false)
      assert.equal(result.aborted, true)
      assert.equal(result.method, 'web-share')
      assert.equal(result.message, 'Save cancelled by user.')
    })
  })

  describe('downloadTimetableImage - Desktop Browser Download', () => {
    it('creates and clicks anchor element for blob download when Web Share is unsupported', async () => {
      const mockBlob = new Blob(['fake-image-bytes'], { type: 'image/png' })
      globalThis.fetch = async () =>
        new Response(mockBlob, { status: 200 })

      setMockNavigator({
        canShare: () => false,
      })

      let clicked = false
      let appended = false
      let removed = false
      let downloadedFilename = ''

      const mockAnchor: any = {
        click: () => { clicked = true },
        set href(_val: string) {},
        set download(val: string) { downloadedFilename = val },
        set rel(_val: string) {},
      }

      ;(globalThis as any).document = {
        createElement: (tag: string) => (tag === 'a' ? mockAnchor : {}),
        body: {
          appendChild: (_el: any) => { appended = true },
          removeChild: (_el: any) => { removed = true },
        },
      }

      ;(globalThis as any).URL.createObjectURL = () => 'blob:https://localhost/mock-blob-uuid'
      ;(globalThis as any).URL.revokeObjectURL = () => {}

      const result = await downloadTimetableImage('https://supabase.co/valid.png', 'Timetable_FY_BTech.png')

      assert.equal(result.success, true)
      assert.equal(result.method, 'browser-download')
      assert.equal(clicked, true)
      assert.equal(appended, true)
      assert.equal(removed, true)
      assert.equal(downloadedFilename, 'Timetable_FY_BTech.png')
    })
  })

  describe('downloadTimetableImage - Capacitor Native APK Flow', () => {
    it('saves directly to Documents directory on native platform', async () => {
      const mockBlob = new Blob(['native-bytes'], { type: 'image/png' })
      globalThis.fetch = async () => new Response(mockBlob, { status: 200 })

      let writtenParams: any = null
      const mockNativeAdapter = {
        isNativePlatform: () => true,
        writeFile: async (options: any) => {
          writtenParams = options
          return { uri: 'file:///storage/emulated/0/Documents/Timetable_2026.png' }
        },
        share: async () => {},
      }

      const result = await downloadTimetableImage(
        'https://supabase.co/image.png',
        'Timetable_2026.png',
        mockNativeAdapter
      )

      assert.equal(result.success, true)
      assert.equal(result.method, 'native-save')
      assert.equal(result.path, 'file:///storage/emulated/0/Documents/Timetable_2026.png')
      assert.ok(writtenParams)
      assert.equal(writtenParams.path, 'Timetable_2026.png')
      assert.equal(writtenParams.directory, Directory.Documents)
    })

    it('falls back to Cache directory and native Share sheet if Documents write fails', async () => {
      const mockBlob = new Blob(['native-bytes'], { type: 'image/png' })
      globalThis.fetch = async () => new Response(mockBlob, { status: 200 })

      let sharedParams: any = null
      const mockNativeAdapter = {
        isNativePlatform: () => true,
        writeFile: async (options: any) => {
          if (options.directory === Directory.Documents) {
            throw new Error('Scoped storage permission denied')
          }
          return { uri: 'file:///data/user/0/app/cache/Timetable_2026.png' }
        },
        share: async (options: any) => {
          sharedParams = options
          return { activityType: 'save' }
        },
      }

      const result = await downloadTimetableImage(
        'https://supabase.co/image.png',
        'Timetable_2026.png',
        mockNativeAdapter
      )

      assert.equal(result.success, true)
      assert.equal(result.method, 'native-share')
      assert.equal(result.path, 'file:///data/user/0/app/cache/Timetable_2026.png')
      assert.ok(sharedParams)
      assert.equal(sharedParams.url, 'file:///data/user/0/app/cache/Timetable_2026.png')
    })

    it('throws helpful error if both direct save and native share fallback fail', async () => {
      const mockBlob = new Blob(['native-bytes'], { type: 'image/png' })
      globalThis.fetch = async () => new Response(mockBlob, { status: 200 })

      const mockNativeAdapter = {
        isNativePlatform: () => true,
        writeFile: async () => {
          throw new Error('Permission denied')
        },
        share: async () => {
          throw new Error('Share activity failed')
        },
      }

      await assert.rejects(
        () => downloadTimetableImage('https://supabase.co/image.png', 'Timetable.png', mockNativeAdapter),
        { message: /Failed to save image on device/ }
      )
    })
  })
})
