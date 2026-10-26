import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDateToISO,
  formatDateForOfficialDisplay,
  publishOfficialTimetable,
  fetchPublishedTimetableByDate,
  fetchLatestPublishedTimetable,
  fetchPublishedDates,
} from '../src/lib/timetableImagePersistence.ts'
import {
  createDefaultMasterTimetable,
  DEFAULT_BRANCHES,
} from '../src/lib/timetableDefaults.ts'

/**
 * Creates an in-memory mock Supabase client for testing private Storage & metadata persistence.
 */
function createMockSupabase(
  initialStore: Record<string, any[]> = {},
  options: {
    failUpload?: boolean
    failSignedUrl?: boolean
    failDbWrite?: boolean
    bucketNotFound?: boolean
  } = {}
) {
  const store: Record<string, any[]> = {
    published_master_timetables: [],
    ...initialStore,
  }

  const uploadedFiles: string[] = []
  const removedFiles: string[] = []
  let nextId = 100

  return {
    store,
    uploadedFiles,
    removedFiles,
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: any) => {
          if (options.bucketNotFound) {
            return {
              data: null,
              error: { message: "The resource was not found", statusCode: '404' },
            }
          }
          if (options.failUpload) {
            return {
              data: null,
              error: { message: 'Storage connection timeout' },
            }
          }
          uploadedFiles.push(path)
          return { data: { path }, error: null }
        },
        createSignedUrl: async (path: string, expiresIn: number) => {
          if (options.failSignedUrl) {
            return {
              data: null,
              error: { message: 'Failed to sign URL' },
            }
          }
          return {
            data: {
              signedUrl: `https://mock-supabase.co/storage/v1/object/sign/${bucket}/${path}?token=mock-jwt-token&exp=${expiresIn}`,
            },
            error: null,
          }
        },
        remove: async (paths: string[]) => {
          removedFiles.push(...paths)
          return { data: paths, error: null }
        },
      }),
    },
    from: (table: string) => {
      if (!store[table]) store[table] = []

      return {
        select: (_fields?: string) => {
          let filters: Array<(row: any) => boolean> = []
          let sortFn: ((a: any, b: any) => number) | null = null
          let limitCount: number | null = null

          const queryObj: any = {
            eq: (col: string, val: any) => {
              filters.push(row => row[col] === val)
              return queryObj
            },
            order: (col: string, { ascending }: { ascending: boolean }) => {
              sortFn = (a, b) => (ascending ? (a[col] > b[col] ? 1 : -1) : a[col] < b[col] ? 1 : -1)
              return queryObj
            },
            limit: (n: number) => {
              limitCount = n
              return queryObj
            },
            maybeSingle: async () => {
              let rows = store[table].filter(r => filters.every(f => f(r)))
              if (sortFn) rows = [...rows].sort(sortFn)
              return { data: rows[0] || null, error: null }
            },
            single: async () => {
              let rows = store[table].filter(r => filters.every(f => f(r)))
              if (sortFn) rows = [...rows].sort(sortFn)
              return { data: rows[0] || null, error: null }
            },
            then: (resolve: any) => {
              let rows = store[table].filter(r => filters.every(f => f(r)))
              if (sortFn) rows = [...rows].sort(sortFn)
              if (limitCount !== null) rows = rows.slice(0, limitCount)
              resolve({ data: rows, error: null })
            },
          }
          return queryObj
        },
        insert: (payload: any) => {
          if (options.failDbWrite) {
            const p: any = Promise.resolve({ data: null, error: { message: 'Database write error' } })
            p.select = () => ({
              single: async () => ({ data: null, error: { message: 'Database write error' } }),
            })
            return p
          }

          const row = { ...payload, id: ++nextId }
          store[table].push(row)
          const p: any = Promise.resolve({ data: [row], error: null })
          p.select = () => ({
            single: async () => ({ data: row, error: null }),
          })
          return p
        },
        update: (updates: any) => ({
          eq: (col: string, val: any) => {
            if (options.failDbWrite) {
              const p: any = Promise.resolve({ error: { message: 'Database update error' } })
              p.select = () => ({
                single: async () => ({ data: null, error: { message: 'Database update error' } }),
              })
              return p
            }

            store[table].forEach(row => {
              if (row[col] === val) Object.assign(row, updates)
            })
            const p: any = Promise.resolve({ error: null })
            p.select = () => ({
              single: async () => {
                const found = store[table].find(r => r[col] === val)
                return { data: found || null, error: null }
              },
            })
            return p
          },
        }),
      }
    },
  }
}

describe('Timetable Maker & Image Persistence Suite', () => {
  describe('Date Format Normalization', () => {
    it('converts DD/MM/YYYY to ISO YYYY-MM-DD', () => {
      assert.strictEqual(normalizeDateToISO('22/10/2026'), '2026-10-22')
      assert.strictEqual(normalizeDateToISO('01/01/2027'), '2027-01-01')
    })

    it('preserves existing YYYY-MM-DD dates unchanged', () => {
      assert.strictEqual(normalizeDateToISO('2026-10-22'), '2026-10-22')
    })

    it('formats ISO dates for official header display as DD/MM/YYYY', () => {
      assert.strictEqual(formatDateForOfficialDisplay('2026-10-22'), '22/10/2026')
      assert.strictEqual(formatDateForOfficialDisplay('2027-01-01'), '01/01/2027')
    })
  })

  describe('Official Master Timetable Defaults', () => {
    it('contains all 4 official BTech branches', () => {
      const template = createDefaultMasterTimetable('22/10/2026')
      assert.deepStrictEqual(template.branches, DEFAULT_BRANCHES)
      assert.strictEqual(template.branches.length, 4)
    })

    it('contains short break and long break with lavender styling', () => {
      const template = createDefaultMasterTimetable('22/10/2026')
      const breaks = template.periods.filter(p => p.isBreak)
      assert.strictEqual(breaks.length, 2)
      assert.strictEqual(breaks[0].breakLabel, 'Short Break')
      assert.strictEqual(breaks[1].breakLabel, 'Long Break')
    })

    it('contains coordinator definitions for all 4 branches', () => {
      const template = createDefaultMasterTimetable('22/10/2026')
      assert.strictEqual(template.coordinators.length, 4)
    })

    it('contains practical roll number batch notes', () => {
      const template = createDefaultMasterTimetable('22/10/2026')
      assert.strictEqual(template.practicalNotes.batch1Roll, 'Roll No. 1 to 33.')
      assert.strictEqual(template.practicalNotes.batch2Roll, 'Roll no. 34 & Onwords.')
    })
  })

  describe('Private Storage Upload & Publication Integrity', () => {
    it('uploads to private storage, obtains signed URL, and records metadata on success', async () => {
      const mockClient = createMockSupabase()
      const gridData = createDefaultMasterTimetable('22/10/2026')

      const published = await publishOfficialTimetable({
        gridData,
        date: '2026-10-22',
        academicYear: '2026-27',
        semester: 1,
        className: 'FY BTECH',
        announcement: 'Lab session tomorrow in 703',
        client: mockClient,
        adminProfileId: 'admin-uuid-1',
      })

      assert.ok(published)
      assert.strictEqual(published.timetable_date, '2026-10-22')
      assert.strictEqual(published.class_name, 'FY BTECH')
      assert.strictEqual(published.announcement, 'Lab session tomorrow in 703')
      assert.ok(published.storage_path?.startsWith('published/timetable_FY_BTECH_2026-10-22_'))
      assert.ok(published.image_url.includes('token=mock-jwt-token'))
      assert.strictEqual(mockClient.uploadedFiles.length, 1)
      assert.strictEqual(mockClient.store.published_master_timetables.length, 1)
    })

    it('fails publication and does not write to database when storage upload fails', async () => {
      const mockClient = createMockSupabase({}, { failUpload: true })
      const gridData = createDefaultMasterTimetable('22/10/2026')

      await assert.rejects(
        async () => {
          await publishOfficialTimetable({
            gridData,
            date: '2026-10-22',
            client: mockClient,
          })
        },
        {
          name: 'Error',
          message: /Storage upload failed/,
        }
      )

      assert.strictEqual(mockClient.store.published_master_timetables.length, 0)
    })

    it('shows helpful error message when storage bucket does not exist', async () => {
      const mockClient = createMockSupabase({}, { bucketNotFound: true })
      const gridData = createDefaultMasterTimetable('22/10/2026')

      await assert.rejects(
        async () => {
          await publishOfficialTimetable({
            gridData,
            date: '2026-10-22',
            client: mockClient,
          })
        },
        {
          name: 'Error',
          message: /Supabase Storage bucket 'timetables' does not exist/,
        }
      )
    })

    it('cleans up orphaned uploaded file if database metadata write fails', async () => {
      const mockClient = createMockSupabase({}, { failDbWrite: true })
      const gridData = createDefaultMasterTimetable('22/10/2026')

      await assert.rejects(
        async () => {
          await publishOfficialTimetable({
            gridData,
            date: '2026-10-22',
            client: mockClient,
          })
        },
        {
          name: 'Error',
          message: /Failed to insert timetable publication record/,
        }
      )

      // Verify compensation: uploaded file was removed from storage
      assert.strictEqual(mockClient.uploadedFiles.length, 1)
      assert.strictEqual(mockClient.removedFiles.length, 1)
      assert.strictEqual(mockClient.removedFiles[0], mockClient.uploadedFiles[0])
      assert.strictEqual(mockClient.store.published_master_timetables.length, 0)
    })

    it('cleans up previous image file when re-publishing an updated timetable for the same date', async () => {
      const oldStoragePath = 'published/timetable_FY_BTECH_2026-10-22_1000.png'
      const mockClient = createMockSupabase({
        published_master_timetables: [
          {
            id: 50,
            timetable_date: '2026-10-22',
            class_name: 'FY BTECH',
            academic_year: '2026-27',
            semester: 1,
            announcement: 'Initial announcement',
            storage_path: oldStoragePath,
            image_url: 'https://mock-supabase.co/old.png',
          },
        ],
      })

      const gridData = createDefaultMasterTimetable('22/10/2026')

      const updated = await publishOfficialTimetable({
        gridData,
        date: '2026-10-22',
        academicYear: '2026-27',
        semester: 1,
        className: 'FY BTECH',
        announcement: 'Updated announcement',
        client: mockClient,
      })

      assert.strictEqual(mockClient.store.published_master_timetables.length, 1)
      assert.strictEqual(updated.announcement, 'Updated announcement')
      // Old storage path was removed from bucket
      assert.ok(mockClient.removedFiles.includes(oldStoragePath))
    })

    it('fetches timetable for a specific date and refreshes signed URL', async () => {
      const mockClient = createMockSupabase({
        published_master_timetables: [
          {
            id: 101,
            timetable_date: '2026-10-21',
            class_name: 'FY BTECH',
            storage_path: 'published/t_21.png',
            image_url: 'https://expired-url/21.png',
          },
        ],
      })

      const t21 = await fetchPublishedTimetableByDate('2026-10-21', 'FY BTECH', mockClient)
      assert.ok(t21)
      assert.strictEqual(t21.id, 101)
      // Signed URL was refreshed with fresh token
      assert.ok(t21.image_url.includes('published/t_21.png?token='))
    })

    it('fetches latest published timetable with refreshed signed URL', async () => {
      const mockClient = createMockSupabase({
        published_master_timetables: [
          {
            id: 101,
            timetable_date: '2026-10-21',
            class_name: 'FY BTECH',
            storage_path: 'published/t_21.png',
          },
          {
            id: 102,
            timetable_date: '2026-10-22',
            class_name: 'FY BTECH',
            storage_path: 'published/t_22.png',
          },
        ],
      })

      const latest = await fetchLatestPublishedTimetable('FY BTECH', mockClient)
      assert.ok(latest)
      assert.strictEqual(latest.timetable_date, '2026-10-22')
      assert.ok(latest.image_url.includes('published/t_22.png?token='))
    })

    it('fetches list of published dates for calendar navigation', async () => {
      const mockClient = createMockSupabase({
        published_master_timetables: [
          { id: 1, timetable_date: '2026-10-21', class_name: 'FY BTECH', announcement: 'Day 1' },
          { id: 2, timetable_date: '2026-10-22', class_name: 'FY BTECH', announcement: null },
        ],
      })

      const dates = await fetchPublishedDates('FY BTECH', mockClient)
      assert.strictEqual(dates.length, 2)
      assert.strictEqual(dates[0].timetable_date, '2026-10-22')
      assert.strictEqual(dates[1].timetable_date, '2026-10-21')
    })
  })

  describe('Official Visual Fidelity & Geometry Validation', () => {
    it('enforces exact reference column proportions for fixed table layout', async () => {
      const { OFFICIAL_TIMETABLE_GEOMETRY } = await import('../src/lib/timetableCellFormatter.ts')
      assert.strictEqual(OFFICIAL_TIMETABLE_GEOMETRY.timeColRatio, 174 / 900)
      assert.strictEqual(OFFICIAL_TIMETABLE_GEOMETRY.branchColRatio, 181.5 / 900)

      // Total of 1 Time column + 4 branch columns must equal 100% (1.0)
      const totalRatio = OFFICIAL_TIMETABLE_GEOMETRY.timeColRatio + 4 * OFFICIAL_TIMETABLE_GEOMETRY.branchColRatio
      assert.strictEqual(Math.round(totalRatio * 1000), 1000)
    })

    it('formats empty cells and free periods with dash and no empty brackets', async () => {
      const { formatCellContent } = await import('../src/lib/timetableCellFormatter.ts')

      // Undefined cell
      const res1 = formatCellContent(undefined)
      assert.deepStrictEqual(res1.lines, ['-'])
      assert.strictEqual(res1.isDash, true)

      // Empty type
      const res2 = formatCellContent({ type: 'empty', text: '-' })
      assert.deepStrictEqual(res2.lines, ['-'])
      assert.strictEqual(res2.isDash, true)

      // Blank subject
      const res3 = formatCellContent({ type: 'theory', subject: '' })
      assert.deepStrictEqual(res3.lines, ['-'])
      assert.strictEqual(res3.isDash, true)
    })

    it('never renders empty brackets for missing faculty abbreviation or room', async () => {
      const { formatCellContent } = await import('../src/lib/timetableCellFormatter.ts')

      // Theory with only subject
      const res1 = formatCellContent({ type: 'theory', subject: 'CHEM' })
      assert.deepStrictEqual(res1.lines, ['CHEM'])
      assert.ok(!res1.lines[0].includes('[]'))
      assert.ok(!res1.lines[0].includes('[undefined]'))

      // Theory with subject and prof
      const res2 = formatCellContent({ type: 'theory', subject: 'CHEM', professorAbbr: 'PSS' })
      assert.deepStrictEqual(res2.lines, ['CHEM [PSS]'])
      assert.ok(!res2.lines[0].includes('[]'))

      // Theory with all fields
      const res3 = formatCellContent({ type: 'theory', subject: 'CHEM', professorAbbr: 'PSS', room: '701' })
      assert.deepStrictEqual(res3.lines, ['CHEM [PSS] [701]'])
    })

    it('formats batch-split practical with numbered lines and no empty brackets', async () => {
      const { formatCellContent } = await import('../src/lib/timetableCellFormatter.ts')

      const res = formatCellContent({
        type: 'practical',
        batch1: { subject: 'CHEM', profAbbr: 'PSS', room: '603' },
        batch2: { subject: 'EM', profAbbr: 'RYP', room: 'EM LAB' },
      })

      assert.strictEqual(res.isBatchSplit, true)
      assert.strictEqual(res.lines.length, 2)
      assert.strictEqual(res.lines[0], '1. CHEM [PSS] [603]')
      assert.strictEqual(res.lines[1], '2. EM [RYP] [EM LAB]')
    })

    it('sanitizes legacy or malformed placeholder text like "[] Practical"', async () => {
      const { formatCellContent } = await import('../src/lib/timetableCellFormatter.ts')

      const res = formatCellContent({
        type: 'practical',
        text: '[] Practical\n[]',
      })

      assert.deepStrictEqual(res.lines, ['-'])
      assert.strictEqual(res.isDash, true)
    })

    it('maintains 1-period batch splits and 2-period practical spans in default timetable', () => {
      const template = createDefaultMasterTimetable('22/10/2026')
      // 2-period genuine spanning practicals
      assert.strictEqual(template.cells['1_0'].rowSpan, 2) // CSE:AIML Practical (08.00-10.00)
      assert.strictEqual(template.cells['7_1'].rowSpan, 2) // ENTC Workshop Practices (01:00-03:00)

      // Single-period batch splits (10:15-11:15)
      assert.strictEqual(template.cells['4_0'].rowSpan, 1) // CSE:AIML CHEM/EM batch split (10:15-11:15)
      assert.strictEqual(template.cells['4_0'].batch1?.subject, 'CHEM')
      assert.strictEqual(template.cells['4_0'].batch2?.subject, 'EM')

      assert.strictEqual(template.cells['4_2'].rowSpan, 1) // COMP PHY/BEEE batch split (10:15-11:15)
      assert.strictEqual(template.cells['4_2'].batch1?.subject, 'PHY')
      assert.strictEqual(template.cells['4_2'].batch2?.subject, 'BEEE')

      // Subsequent 11:15-12:15 period intentionally contains free-period dashes
      assert.strictEqual(template.cells['5_0']?.type, 'empty')
      assert.strictEqual(template.cells['5_0']?.text, '-')
      assert.strictEqual(template.cells['5_2']?.type, 'empty')
      assert.strictEqual(template.cells['5_2']?.text, '-')

      // Other verified free periods
      assert.strictEqual(template.cells['7_3'].type, 'empty')
      assert.strictEqual(template.cells['8_2'].type, 'empty')
      assert.strictEqual(template.cells['8_3'].type, 'empty')
    })
  })
})
