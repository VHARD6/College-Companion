import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  doPeriodsOverlap,
  validateMasterTimetable,
} from '../src/lib/timetableValidation.ts'
import type {
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
} from '../src/types/timetableStudio.ts'

describe('Timetable Studio Validation Engine', () => {
  const samplePeriods: MasterTimetablePeriod[] = [
    { id: 1, timetable_id: 1, period_order: 1, start_time: '08:45', end_time: '09:45', is_break: false },
    { id: 2, timetable_id: 1, period_order: 2, start_time: '09:45', end_time: '10:45', is_break: false },
    { id: 3, timetable_id: 1, period_order: 3, start_time: '10:45', end_time: '11:00', is_break: true, break_label: 'Short Recess' },
    { id: 4, timetable_id: 1, period_order: 4, start_time: '11:00', end_time: '12:00', is_break: false },
    { id: 5, timetable_id: 1, period_order: 5, start_time: '12:00', end_time: '13:00', is_break: false },
    { id: 6, timetable_id: 1, period_order: 6, start_time: '13:00', end_time: '13:45', is_break: true, break_label: 'Lunch Break' },
    { id: 7, timetable_id: 1, period_order: 7, start_time: '13:45', end_time: '14:45', is_break: false },
    { id: 8, timetable_id: 1, period_order: 8, start_time: '14:45', end_time: '15:45', is_break: false },
  ]

  const periodMap = new Map<number, MasterTimetablePeriod>(samplePeriods.map(p => [p.id, p]))

  const sampleColumns: MasterTimetableColumn[] = [
    { id: 101, timetable_id: 1, class_id: 1, column_order: 1, display_label: 'TE Computer (Div A)' },
    { id: 102, timetable_id: 1, class_id: 2, column_order: 2, display_label: 'TE Computer (Div B)' },
    { id: 103, timetable_id: 1, class_id: 3, column_order: 3, display_label: 'TE AI & DS' },
  ]

  const sampleProfessors = new Map<number, { name: string; abbreviation: string | null }>([
    [1, { name: 'K. V. Kadam', abbreviation: 'KVK' }],
    [2, { name: 'R. Y. Pawar', abbreviation: 'RYP' }],
    [3, { name: 'P. Patil', abbreviation: 'PP' }],
    [4, { name: 'Unassigned Initials Prof', abbreviation: null }],
  ])

  const sampleBatchesByClass = new Map<number, number[]>([
    [1, [11, 12, 13]], // Div A: B1, B2, B3
    [2, [21, 22, 23]], // Div B: B1, B2, B3
  ])

  describe('Period Overlap Logic', () => {
    it('detects exact same period overlap', () => {
      assert.equal(doPeriodsOverlap(periodMap, 1, 1, 1, 1), true)
    })

    it('detects multi-period span overlapping single period', () => {
      // Period 1-2 practical overlapping Period 2 lecture
      assert.equal(doPeriodsOverlap(periodMap, 1, 2, 2, 2), true)
      // Period 1-2 practical NOT overlapping Period 4 lecture
      assert.equal(doPeriodsOverlap(periodMap, 1, 2, 4, 4), false)
    })

    it('returns false for adjacent non-overlapping periods', () => {
      assert.equal(doPeriodsOverlap(periodMap, 1, 1, 2, 2), false)
    })
  })

  describe('VAL-01: Professor Double-Booking', () => {
    it('flags an error when the same professor is scheduled across two branches in the same period', () => {
      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 1,
          end_period_id: 1,
          column_id: 101, // Div A
          entry_type: 'lecture',
          subentries: [{ subject_id: 501, professor_id: 1, room: 'R401' }],
        },
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 1,
          end_period_id: 1,
          column_id: 102, // Div B (Same time, same professor)
          entry_type: 'lecture',
          subentries: [{ subject_id: 502, professor_id: 1, room: 'R402' }],
        },
      ]

      const result = validateMasterTimetable({
        periods: samplePeriods,
        columns: sampleColumns,
        entries,
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.isValid, false)
      assert.equal(result.hasErrors, true)
      assert.equal(result.errors.some(e => e.code === 'VAL-01' && e.professorId === 1), true)
    })

    it('allows the same professor scheduled on different weekdays or different periods', () => {
      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 0, // Mon
          start_period_id: 1,
          end_period_id: 1,
          column_id: 101,
          entry_type: 'lecture',
          subentries: [{ subject_id: 501, professor_id: 1, room: 'R401' }],
        },
        {
          timetable_id: 1,
          weekday: 0, // Mon, but Period 2
          start_period_id: 2,
          end_period_id: 2,
          column_id: 102,
          entry_type: 'lecture',
          subentries: [{ subject_id: 502, professor_id: 1, room: 'R402' }],
        },
      ]

      const result = validateMasterTimetable({
        periods: samplePeriods,
        columns: sampleColumns,
        entries,
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.errors.some(e => e.code === 'VAL-01'), false)
    })
  })

  describe('VAL-02: Room Double-Booking', () => {
    it('flags an error when the same room is assigned to different branches in overlapping periods', () => {
      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 1, // Tue
          start_period_id: 4,
          end_period_id: 4,
          column_id: 101,
          entry_type: 'lecture',
          subentries: [{ subject_id: 501, professor_id: 1, room: 'Lab 2' }],
        },
        {
          timetable_id: 1,
          weekday: 1, // Tue, same period 4
          start_period_id: 4,
          end_period_id: 4,
          column_id: 102,
          entry_type: 'lecture',
          subentries: [{ subject_id: 502, professor_id: 2, room: 'Lab 2' }], // Conflicting room
        },
      ]

      const result = validateMasterTimetable({
        periods: samplePeriods,
        columns: sampleColumns,
        entries,
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.errors.some(e => e.code === 'VAL-02' && e.room === 'Lab 2'), true)
    })
  })

  describe('VAL-03: Batch Overlap', () => {
    it('flags an error if a batch is scheduled in multiple overlapping sessions', () => {
      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 2, // Wed
          start_period_id: 7,
          end_period_id: 8, // 2-period practical
          column_id: 101,
          entry_type: 'practical',
          subentries: [
            { subject_id: 511, professor_id: 1, batch_id: 11, room: 'Lab 1' },
          ],
        },
        {
          timetable_id: 1,
          weekday: 2,
          start_period_id: 8, // Overlaps with period 7-8 above
          end_period_id: 8,
          column_id: 101,
          entry_type: 'tutorial',
          subentries: [
            { subject_id: 512, professor_id: 2, batch_id: 11, room: 'R401' }, // Batch 11 again!
          ],
        },
      ]

      const result = validateMasterTimetable({
        periods: samplePeriods,
        columns: sampleColumns,
        entries,
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.errors.some(e => e.code === 'VAL-03' && e.batchId === 11), true)
    })
  })

  describe('VAL-04: Unassigned Practical Batch Warning', () => {
    it('produces a soft warning when a practical block omits a declared batch of the class', () => {
      // Class 1 (Div A) has batches 11, 12, 13
      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 3, // Thu
          start_period_id: 7,
          end_period_id: 8,
          column_id: 101, // Div A
          entry_type: 'practical',
          subentries: [
            { subject_id: 511, professor_id: 1, batch_id: 11, room: 'Lab 1' },
            { subject_id: 512, professor_id: 2, batch_id: 12, room: 'Lab 2' },
            // Batch 13 is missing!
          ],
        },
      ]

      const result = validateMasterTimetable({
        periods: samplePeriods,
        columns: sampleColumns,
        entries,
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.warnings.some(w => w.code === 'VAL-04'), true)
    })
  })

  describe('VAL-05: Time Discontinuity Warning', () => {
    it('produces a warning when consecutive periods have an unexplained time gap', () => {
      const gappedPeriods: MasterTimetablePeriod[] = [
        { id: 1, timetable_id: 1, period_order: 1, start_time: '08:45', end_time: '09:45', is_break: false },
        { id: 2, timetable_id: 1, period_order: 2, start_time: '10:00', end_time: '11:00', is_break: false }, // 15min unlabelled gap
      ]

      const result = validateMasterTimetable({
        periods: gappedPeriods,
        columns: sampleColumns,
        entries: [],
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.warnings.some(w => w.code === 'VAL-05'), true)
    })
  })

  describe('VAL-06: Missing Professor Abbreviation', () => {
    it('flags an error when a professor assigned in the timetable lacks an explicit abbreviation', () => {
      const entries: MasterTimetableEntry[] = [
        {
          timetable_id: 1,
          weekday: 4, // Fri
          start_period_id: 1,
          end_period_id: 1,
          column_id: 101,
          entry_type: 'lecture',
          subentries: [{ subject_id: 501, professor_id: 4, room: 'R401' }], // Prof 4 has abbreviation: null
        },
      ]

      const result = validateMasterTimetable({
        periods: samplePeriods,
        columns: sampleColumns,
        entries,
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.errors.some(e => e.code === 'VAL-06' && e.professorId === 4), true)
    })
  })

  describe('Clean and Valid Master Timetable', () => {
    it('passes cleanly with zero errors when all rules and constraints are satisfied', () => {
      const entries: MasterTimetableEntry[] = [
        // Monday Period 1: Div A has DBMS [KVK], Div B has CN [RYP]
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 1,
          end_period_id: 1,
          column_id: 101,
          entry_type: 'lecture',
          subentries: [{ subject_id: 501, professor_id: 1, room: 'R401' }],
        },
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 1,
          end_period_id: 1,
          column_id: 102,
          entry_type: 'lecture',
          subentries: [{ subject_id: 502, professor_id: 2, room: 'R402' }],
        },
        // Monday Period 3: Recess (Break)
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 3,
          end_period_id: 3,
          column_id: null, // Full-width break
          entry_type: 'break',
          common_break_label: 'Short Recess',
          subentries: [],
        },
        // Monday Period 7-8: Div A Lab block (All 3 batches assigned with distinct rooms and professors)
        {
          timetable_id: 1,
          weekday: 0,
          start_period_id: 7,
          end_period_id: 8,
          column_id: 101,
          entry_type: 'practical',
          subentries: [
            { subject_id: 511, professor_id: 1, batch_id: 11, room: 'Lab 1' },
            { subject_id: 512, professor_id: 2, batch_id: 12, room: 'Lab 2' },
            { subject_id: 513, professor_id: 3, batch_id: 13, room: 'Lab 3' },
          ],
        },
      ]

      const result = validateMasterTimetable({
        periods: samplePeriods,
        columns: sampleColumns,
        entries,
        professorsById: sampleProfessors,
        batchesByClassId: sampleBatchesByClass,
      })

      assert.equal(result.isValid, true)
      assert.equal(result.hasErrors, false)
      assert.equal(result.errors.length, 0)
    })
  })
})
