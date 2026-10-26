import type { MasterTimetableGridData } from '../types/timetableMaker.ts'

export const DEFAULT_BRANCHES = ['CSE:AIML', 'ENTC', 'COMP', 'IT']

export const DEFAULT_PERIODS = [
  { id: 1, startTime: '08.00', endTime: '09.00' },
  { id: 2, startTime: '09.00', endTime: '10.00' },
  { id: 3, startTime: '10.00', endTime: '10.15', isBreak: true, breakLabel: 'Short Break' },
  { id: 4, startTime: '10:15', endTime: '11:15' },
  { id: 5, startTime: '11:15', endTime: '12:15' },
  { id: 6, startTime: '12:15', endTime: '01:00', isBreak: true, breakLabel: 'Long Break' },
  { id: 7, startTime: '01:00', endTime: '02:00' },
  { id: 8, startTime: '02:00', endTime: '03:00' },
]

export const DEFAULT_COORDINATORS = [
  { branch: 'CSE:AIML', name: 'Prof. Pritesh Shindade' },
  { branch: 'ENTC', name: 'Prof. Rutuja Patil' },
  { branch: 'COMP', name: 'Prof. Ketan Karandikar' },
  { branch: 'IT', name: 'Prof. Chandan Mahajan' },
]

export const DEFAULT_PRACTICAL_NOTES = {
  batch1Roll: 'Roll No. 1 to 33.',
  batch2Roll: 'Roll no. 34 & Onwords.',
}

/**
 * Returns the default timetable template matching the college official reference.
 */
export function createDefaultMasterTimetable(dateStr = '22/10/2026'): MasterTimetableGridData {
  return {
    academicYear: '2026-27',
    semester: 'I',
    className: 'FY BTECH',
    date: dateStr,
    branches: [...DEFAULT_BRANCHES],
    periods: [...DEFAULT_PERIODS],
    cells: {
      // 08.00-10.00 CSE:AIML Practical (Spans Period 1 & 2)
      '1_0': {
        type: 'practical',
        subject: 'CS',
        professorAbbr: 'PP',
        room: '703',
        rowSpan: 2,
        text: 'CS [PP] Practical\n[703]',
      },
      // 08.00-09.00
      '1_1': { type: 'theory', subject: 'CHEM', professorAbbr: 'PSS', room: '702' },
      '1_2': { type: 'theory', subject: 'EG', professorAbbr: 'KVK', room: '701' },
      '1_3': { type: 'theory', subject: 'PHY', professorAbbr: 'CDM', room: '403' },

      // 09.00-10.00
      '2_1': { type: 'theory', subject: 'EM', professorAbbr: 'RYP', room: '702' },
      '2_2': { type: 'theory', subject: 'PHY', professorAbbr: 'CDM', room: '701' },
      '2_3': { type: 'theory', subject: 'EM-I', professorAbbr: 'ST', room: '403' },

      // 10:15-11:15: Batch splits occurring within the same one-hour period (rowSpan: 1)
      '4_0': {
        type: 'practical',
        rowSpan: 1,
        batch1: { subject: 'CHEM', profAbbr: 'PSS', room: '603' },
        batch2: { subject: 'EM', profAbbr: 'RYP', room: 'EM LAB' },
      },
      '4_1': { type: 'theory', subject: 'CS', professorAbbr: 'PP', room: '703' },
      '4_2': {
        type: 'practical',
        rowSpan: 1,
        batch1: { subject: 'PHY', profAbbr: 'CDM', room: '602' },
        batch2: { subject: 'BEEE', profAbbr: 'ABI', room: '601' },
      },
      '4_3': { type: 'theory', subject: 'EG', professorAbbr: 'AP', room: '403' },

      // 11:15-12:15: Free periods in CSE:AIML and COMP displaying dashes
      '5_0': { type: 'empty', text: '-' },
      '5_1': { type: 'theory', subject: 'EM-I', professorAbbr: 'ST', room: '703' },
      '5_2': { type: 'empty', text: '-' },
      '5_3': { type: 'theory', subject: 'BCME', professorAbbr: 'KVK', room: '403' },

      // 01:00-02:00
      '7_0': { type: 'theory', subject: 'CHEM', professorAbbr: 'PSS', room: '403' },
      '7_1': {
        type: 'practical',
        subject: 'Workshop Practices',
        professorAbbr: 'KVK',
        room: 'Workshop',
        rowSpan: 2,
        text: 'Workshop Practices\n[KVK]\n[Workshop]',
      },
      '7_2': { type: 'theory', subject: 'EM-I', professorAbbr: 'ST', room: '702' },
      '7_3': { type: 'empty', text: '-' },

      // 02:00-03:00
      '8_0': { type: 'theory', subject: 'EM', professorAbbr: 'RYP', room: '403' },
      '8_2': { type: 'empty', text: '-' },
      '8_3': { type: 'empty', text: '-' },
    },
    coordinators: [...DEFAULT_COORDINATORS],
    practicalNotes: { ...DEFAULT_PRACTICAL_NOTES },
  }
}
