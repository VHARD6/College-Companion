import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { syncMasterTimetableToSlots } from '../src/lib/timetableSyncAdapter.ts'
import {
  saveMasterTimetableDraft,
  publishMasterTimetable,
  duplicateAsNewVersion,
  fetchPublishedMasterTimetableForStudent,
  type MasterTimetableDraftInput,
} from '../src/lib/timetablePersistence.ts'
import type {
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
} from '../src/types/timetableStudio.ts'

/**
 * Creates an in-memory mock Supabase client for unit testing persistence & queries.
 */
function createMockSupabase(initialData: Record<string, any[]> = {}) {
  const store: Record<string, any[]> = {
    master_timetables: [],
    master_timetable_periods: [],
    master_timetable_columns: [],
    master_timetable_entries: [],
    master_timetable_subentries: [],
    teaching_assignments: [],
    timetable_slots: [],
    ...initialData,
  }

  let nextId = 1000

  return {
    store,
    from: (table: string) => {
      if (!store[table]) store[table] = []

      return {
        // INSERT
        insert: (payload: any) => {
          const items = Array.isArray(payload) ? payload : [payload]
          const inserted = items.map(item => {
            const row = { ...item, id: item.id || ++nextId }
            store[table].push(row)
            return row
          })

          const resultPromise: any = Promise.resolve({ data: inserted, error: null })
          resultPromise.select = () => {
            const selectPromise: any = Promise.resolve({ data: inserted, error: null })
            selectPromise.single = async () => ({ data: inserted[0], error: null })
            return selectPromise
          }
          resultPromise.single = async () => ({ data: inserted[0], error: null })
          return resultPromise
        },

        // UPDATE
        update: (updates: any) => ({
          eq: (col: string, val: any) => {
            store[table].forEach(row => {
              if (row[col] === val) {
                Object.assign(row, updates)
              }
            })
            return Promise.resolve({ error: null })
          },
        }),

        // DELETE
        delete: () => ({
          eq: (col: string, val: any) => {
            store[table] = store[table].filter(row => row[col] !== val)
            return Promise.resolve({ error: null })
          },
        }),

        // SELECT / QUERY
        select: (_fields?: string) => {
          let filters: Array<(row: any) => boolean> = []

          const createQueryObject = () => {
            const queryObj: any = {
              eq: (col: string, val: any) => {
                filters.push(row => {
                  if (col.includes('.')) {
                    const [rel, field] = col.split('.')
                    return row[rel]?.[field] === val
                  }
                  return row[col] === val
                })
                return queryObj
              },
              is: (col: string, val: any) => {
                filters.push(row => row[col] === val)
                return queryObj
              },
              in: (col: string, vals: any[]) => {
                filters.push(row => vals.includes(row[col]))
                return queryObj
              },
              order: () => queryObj,
              maybeSingle: async () => {
                const results = store[table].filter(r => filters.every(f => f(r)))
                return { data: results[0] || null, error: null }
              },
              single: async () => {
                const results = store[table].filter(r => filters.every(f => f(r)))
                return { data: results[0] || null, error: null }
              },
              then: (resolve: any, reject?: any) => {
                try {
                  const results = store[table].filter(r => filters.every(f => f(r)))
                  return Promise.resolve(resolve({ data: results, error: null }))
                } catch (e) {
                  if (reject) return Promise.resolve(reject(e))
                  throw e
                }
              },
            }
            return queryObj
          }

          return createQueryObject()
        },
      }
    },
  }
}

describe('Timetable Sync Adapter & Persistence Suite', () => {
  const samplePeriods: MasterTimetablePeriod[] = [
    { id: 1, timetable_id: 1, period_order: 1, start_time: '08:45', end_time: '09:45', is_break: false },
    { id: 2, timetable_id: 1, period_order: 2, start_time: '09:45', end_time: '10:45', is_break: false },
    { id: 3, timetable_id: 1, period_order: 3, start_time: '10:45', end_time: '11:00', is_break: true, break_label: 'Short Recess' },
  ]

  const sampleColumns: MasterTimetableColumn[] = [
    { id: 10, timetable_id: 1, class_id: 101, column_order: 1, display_label: 'TE CS-A' },
  ]

  describe('Timetable Sync Adapter (syncMasterTimetableToSlots)', () => {
    it('uses .eq("batch_id", id) when practical batch_id is a non-null integer', async () => {
      let batchFilterType: string | null = null
      let batchFilterVal: any = null

      const client = createMockSupabase({
        teaching_assignments: [
          { id: 777, professor_id: 12, subject_id: 501, class_id: 101, batch_id: 42 },
        ],
      })

      // Intercept calls to teaching_assignments to verify .eq vs .is
      const origFrom = client.from
      client.from = (table: string) => {
        const handler = origFrom(table)
        if (table === 'teaching_assignments') {
          const origSelect = handler.select
          handler.select = (fields?: string) => {
            const query = origSelect(fields)
            const origEq = query.eq
            const origIs = query.is
            query.eq = (col: string, val: any) => {
              if (col === 'batch_id') {
                batchFilterType = 'eq'
                batchFilterVal = val
              }
              return origEq(col, val)
            }
            query.is = (col: string, val: any) => {
              if (col === 'batch_id') {
                batchFilterType = 'is'
                batchFilterVal = val
              }
              return origIs(col, val)
            }
            return query
          }
        }
        return handler
      }

      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 1,
          start_period_id: 1,
          end_period_id: 1,
          column_id: 10,
          entry_type: 'practical',
          subentries: [
            {
              subject_id: 501,
              professor_id: 12,
              batch_id: 42,
              room: 'Lab 1',
            },
          ],
        },
      ]

      const result = await syncMasterTimetableToSlots(1, samplePeriods, sampleColumns, entries, client)
      assert.equal(result.projectedCount, 1)
      assert.equal(batchFilterType, 'eq', 'Must use .eq() for non-null integer batch_id')
      assert.equal(batchFilterVal, 42)
      assert.equal(client.store.timetable_slots.length, 1)
      assert.equal(client.store.timetable_slots[0].teaching_assignment_id, 777)
    })

    it('uses .is("batch_id", null) when batch_id is null or undefined', async () => {
      let batchFilterType: string | null = null
      let batchFilterVal: any = null

      const client = createMockSupabase({
        teaching_assignments: [
          { id: 888, professor_id: 15, subject_id: 502, class_id: 101, batch_id: null },
        ],
      })

      const origFrom = client.from
      client.from = (table: string) => {
        const handler = origFrom(table)
        if (table === 'teaching_assignments') {
          const origSelect = handler.select
          handler.select = (fields?: string) => {
            const query = origSelect(fields)
            const origEq = query.eq
            const origIs = query.is
            query.eq = (col: string, val: any) => {
              if (col === 'batch_id') {
                batchFilterType = 'eq'
                batchFilterVal = val
              }
              return origEq(col, val)
            }
            query.is = (col: string, val: any) => {
              if (col === 'batch_id') {
                batchFilterType = 'is'
                batchFilterVal = val
              }
              return origIs(col, val)
            }
            return query
          }
        }
        return handler
      }

      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 1,
          end_period_id: 1,
          column_id: 10,
          entry_type: 'lecture',
          subentries: [
            {
              subject_id: 502,
              professor_id: 15,
              batch_id: null,
              room: 'Room 301',
            },
          ],
        },
      ]

      const result = await syncMasterTimetableToSlots(1, samplePeriods, sampleColumns, entries, client)
      assert.equal(result.projectedCount, 1)
      assert.equal(batchFilterType, 'is', 'Must use .is() for null batch_id')
      assert.equal(batchFilterVal, null)
      assert.equal(client.store.timetable_slots.length, 1)
      assert.equal(client.store.timetable_slots[0].teaching_assignment_id, 888)
    })

    it('prevents duplicate slots when a slot with identical bounds already exists', async () => {
      const client = createMockSupabase({
        teaching_assignments: [
          { id: 999, professor_id: 10, subject_id: 501, class_id: 101, batch_id: null },
        ],
        timetable_slots: [
          {
            id: 456,
            teaching_assignment_id: 999,
            weekday: 2,
            start_time: '08:45',
            end_time: '09:45',
            room: 'Room 101',
          },
        ],
      })

      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 2,
          start_period_id: 1,
          end_period_id: 1,
          column_id: 10,
          entry_type: 'lecture',
          subentries: [{ subject_id: 501, professor_id: 10, batch_id: null }],
        },
      ]

      const result = await syncMasterTimetableToSlots(1, samplePeriods, sampleColumns, entries, client)
      assert.equal(result.projectedCount, 0, 'Projected count must be 0 for duplicate slot')
      assert.equal(client.store.timetable_slots.length, 1, 'No new row should be inserted')
    })

    it('ignores break entries without creating operational timetable slots', async () => {
      const client = createMockSupabase()

      const breakEntries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 3,
          end_period_id: 3,
          entry_type: 'break',
          common_break_label: 'Short Recess',
          subentries: [],
        },
      ]

      const result = await syncMasterTimetableToSlots(1, samplePeriods, sampleColumns, breakEntries, client)
      assert.equal(result.projectedCount, 0)
      assert.equal(client.store.timetable_slots.length, 0)
    })
  })

  describe('Timetable Persistence Service', () => {
    it('serializes and saves a new draft into database tables', async () => {
      const client = createMockSupabase()

      const draft: MasterTimetableDraftInput = {
        title: 'TE 2026-27 Sem 5',
        academic_year: '2026-27',
        semester: 5,
        cohort: 'TE',
        effective_date: '2026-08-01',
        header_title: 'Engineering Institute',
        header_subtitle: 'Dept of Computer Eng',
        periods: samplePeriods,
        columns: sampleColumns,
        entries: [
          {
            timetable_id: 1,
            weekday: 0,
            start_period_id: 1,
            end_period_id: 1,
            column_id: 10,
            entry_type: 'lecture',
            subentries: [
              {
                subject_id: 501,
                professor_id: 1,
                room: 'Room 101',
              },
            ],
          },
        ],
      }

      const saved = await saveMasterTimetableDraft(draft, client, 'user-uuid-123')
      assert.ok(saved.id)
      assert.equal(saved.title, 'TE 2026-27 Sem 5')
      assert.equal(saved.status, 'draft')
      assert.equal(client.store.master_timetables.length, 1)
      assert.equal(client.store.master_timetable_periods.length, 3)
      assert.equal(client.store.master_timetable_columns.length, 1)
      assert.equal(client.store.master_timetable_entries.length, 1)
      assert.equal(client.store.master_timetable_subentries.length, 1)
    })

    it('duplicates a published master timetable into a new draft with incremented version', async () => {
      const client = createMockSupabase({
        master_timetables: [
          {
            id: 50,
            title: 'TE 2026-27 Sem 5',
            academic_year: '2026-27',
            semester: 5,
            cohort: 'TE',
            effective_date: '2026-08-01',
            status: 'published',
            version: 1,
            header_title: 'College',
            header_subtitle: 'Dept',
          },
        ],
        master_timetable_periods: samplePeriods.map(p => ({ ...p, timetable_id: 50 })),
        master_timetable_columns: sampleColumns.map(c => ({ ...c, timetable_id: 50 })),
      })

      const newDraft = await duplicateAsNewVersion(50, client, 'admin-uuid')
      assert.equal(newDraft.version, 2, 'New version must be incremented to 2')
      assert.equal(newDraft.status, 'draft', 'New version must start as draft')
      assert.equal(client.store.master_timetables.length, 2, 'Must have original published row and new draft row')
      const original = client.store.master_timetables.find(t => t.id === 50)
      assert.equal(original.status, 'published', 'Original published timetable must remain untouched')
    })

    it('publishes a timetable and triggers sync to operational timetable_slots', async () => {
      const client = createMockSupabase({
        master_timetables: [
          {
            id: 80,
            title: 'TE Master Draft',
            academic_year: '2026-27',
            semester: 5,
            cohort: 'TE',
            effective_date: '2026-08-01',
            status: 'draft',
            version: 1,
          },
        ],
        master_timetable_periods: [
          { id: 1, timetable_id: 80, period_order: 1, start_time: '08:45', end_time: '09:45', is_break: false },
        ],
        master_timetable_columns: [
          { id: 10, timetable_id: 80, class_id: 101, column_order: 1, display_label: 'TE CS-A' },
        ],
        master_timetable_entries: [
          {
            id: 900,
            timetable_id: 80,
            weekday: 1,
            start_period_id: 1,
            end_period_id: 1,
            column_id: 10,
            entry_type: 'lecture',
          },
        ],
        master_timetable_subentries: [
          {
            id: 950,
            entry_id: 900,
            subject_id: 601,
            professor_id: 25,
            batch_id: null,
            room: 'Room 202',
          },
        ],
      })

      const result = await publishMasterTimetable(80, client)
      assert.equal(result.timetable.status, 'published')
      assert.equal(result.projectedSlots, 1)
      assert.equal(client.store.timetable_slots.length, 1)
      assert.equal(client.store.timetable_slots[0].weekday, 1)
      assert.equal(client.store.timetable_slots[0].start_time, '08:45')
    })

    it('enforces status = "published" and excludes drafts for student query', async () => {
      const client = createMockSupabase({
        master_timetables: [
          {
            id: 10,
            title: 'Published Timetable',
            status: 'published',
            version: 1,
            academic_year: '2026-27',
            semester: 5,
            cohort: 'TE',
            effective_date: '2026-08-01',
            published_at: '2026-08-01T00:00:00Z',
          },
          {
            id: 11,
            title: 'Secret Unpublished Draft',
            status: 'draft',
            version: 2,
            academic_year: '2026-27',
            semester: 5,
            cohort: 'TE',
            effective_date: '2026-08-01',
          },
        ],
        master_timetable_columns: [
          {
            id: 101,
            timetable_id: 10,
            class_id: 55,
            column_order: 1,
            display_label: 'Class 55',
            master_timetables: { id: 10, status: 'published', version: 1, semester: 5 },
          },
          {
            id: 102,
            timetable_id: 11,
            class_id: 55,
            column_order: 1,
            display_label: 'Class 55 Draft',
            master_timetables: { id: 11, status: 'draft', version: 2, semester: 5 },
          },
        ],
        master_timetable_periods: [
          { id: 1, timetable_id: 10, period_order: 1, start_time: '08:45', end_time: '09:45', is_break: false },
        ],
        master_timetable_entries: [],
      })

      const studentTimetable = await fetchPublishedMasterTimetableForStudent(55, 5, client)
      assert.ok(studentTimetable)
      assert.equal(studentTimetable.id, 10, 'Student query must load the published timetable (#10), never draft (#11)')
      assert.equal(studentTimetable.status, 'published')
    })
  })
})
