import type { TimetableCellData } from '../types/timetableMaker.ts'

/**
 * Official College Timetable Geometry & Proportions.
 * Measured directly from the college reference images (900px content width).
 */
export const OFFICIAL_TIMETABLE_GEOMETRY = {
  // Proportions (out of total content width):
  // Reference: Time column = 174px, Branches (4) = 181.5px each -> Total 900px
  timeColRatio: 174 / 900, // 0.193333... (19.333%)
  branchColRatio: 181.5 / 900, // 0.201666... (20.167%)

  // Percentages for CSS table-fixed columns
  timeColPercent: '19.333%',
  branchColPercent: '20.167%',

  // Official colors sampled from the reference images:
  colors: {
    border: '#000000',
    headerBg: '#FFFFFF',
    masterTimeTableBarBg: '#D9D9D9',
    gridHeaderBg: '#C7DDB5', // Soft Sage Green
    breakRowBg: '#DCD6EB',   // Soft Lavender
    practicalBg: '#FAD2D2',  // Soft Peach/Pink for Practicals
    freeCellBg: '#FFFFFF',   // White
    theoryBg: '#FFFFFF',     // Pure White
    dateRed: '#D00000',      // Official Bold College Red
    coordinatorHeaderBg: '#DCD6EB',
    coordinatorContentBg: '#FFFFFF',
    noteLeftBg: '#FFFFFF',
    noteRightBatchBg: '#CFE2F3', // Soft light blue
  },

  // Proportions for Coordinator table:
  coordCol0Ratio: 174 / 900, // Aligns with Time column
  coordBranchRatio: 181.5 / 900, // Aligns with branch columns

  // Proportions for Practical Notes footer:
  noteLeftRatio: 426 / 900, // 47.33%
  noteBatchLabelRatio: 146 / 474, // 30.8% of the right batch sub-table
}

export interface FormattedCellContent {
  lines: string[]
  isBatchSplit: boolean
  isDash: boolean
  bgColor: string
}

/**
 * Returns formatted lines of text and background color for any cell,
 * strictly matching official college reference rules and preventing
 * empty brackets or invalid placeholders.
 */
export function formatCellContent(cell?: TimetableCellData): FormattedCellContent {
  if (!cell || cell.type === 'empty') {
    return {
      lines: ['-'],
      isBatchSplit: false,
      isDash: true,
      bgColor: OFFICIAL_TIMETABLE_GEOMETRY.colors.freeCellBg,
    }
  }

  // 1. Practical with Batch Split (Batch 1 & Batch 2)
  if (cell.type === 'practical' && cell.batch1 && cell.batch2) {
    const b1Subj = cell.batch1.subject?.trim()
    const b2Subj = cell.batch2.subject?.trim()

    // If both batches are empty, show dash
    if (!b1Subj && !b2Subj) {
      return {
        lines: ['-'],
        isBatchSplit: false,
        isDash: true,
        bgColor: OFFICIAL_TIMETABLE_GEOMETRY.colors.freeCellBg,
      }
    }

    const b1Prof = cell.batch1.profAbbr?.trim()
    const b1Room = cell.batch1.room?.trim()
    let line1 = `1. ${b1Subj || 'TBA'}`
    if (b1Prof) line1 += ` [${b1Prof}]`
    if (b1Room) line1 += ` [${b1Room}]`

    const b2Prof = cell.batch2.profAbbr?.trim()
    const b2Room = cell.batch2.room?.trim()
    let line2 = `2. ${b2Subj || 'TBA'}`
    if (b2Prof) line2 += ` [${b2Prof}]`
    if (b2Room) line2 += ` [${b2Room}]`

    return {
      lines: [line1, line2],
      isBatchSplit: true,
      isDash: false,
      bgColor: '#FFFFFF', // In reference 3, batch-splits are white with bold lines
    }
  }

  // 2. Single / 2-Period Practical
  if (cell.type === 'practical') {
    // If custom text was saved, sanitize it
    if (cell.text && cell.text.trim()) {
      const sanitized = cell.text
        .replace(/\[\s*\]/g, '') // remove empty brackets like []
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)

      if (sanitized.length > 0 && sanitized[0] !== 'Practical') {
        return {
          lines: sanitized,
          isBatchSplit: false,
          isDash: false,
          bgColor: OFFICIAL_TIMETABLE_GEOMETRY.colors.practicalBg,
        }
      }
    }

    const subj = cell.subject?.trim()
    if (!subj || subj === '-') {
      return {
        lines: ['-'],
        isBatchSplit: false,
        isDash: true,
        bgColor: OFFICIAL_TIMETABLE_GEOMETRY.colors.freeCellBg,
      }
    }

    const prof = cell.professorAbbr?.trim()
    const room = cell.room?.trim()

    const isWorkshop = subj.toLowerCase().includes('workshop')
    const isPractical = subj.toLowerCase().includes('practical')

    let line1 = subj
    if (prof) line1 += ` [${prof}]`
    if (!isWorkshop && !isPractical) line1 += ' Practical'

    const lines = [line1]
    if (room) lines.push(`[${room}]`)

    return {
      lines,
      isBatchSplit: false,
      isDash: false,
      bgColor: isWorkshop ? '#FFFFFF' : OFFICIAL_TIMETABLE_GEOMETRY.colors.practicalBg,
    }
  }

  // 3. Theory Lecture
  const subj = cell.subject?.trim()
  if (!subj || subj === '-') {
    return {
      lines: ['-'],
      isBatchSplit: false,
      isDash: true,
      bgColor: OFFICIAL_TIMETABLE_GEOMETRY.colors.theoryBg,
    }
  }

  const prof = cell.professorAbbr?.trim()
  const room = cell.room?.trim()

  let line = subj
  if (prof) line += ` [${prof}]`
  if (room) line += ` [${room}]`

  return {
    lines: [line],
    isBatchSplit: false,
    isDash: false,
    bgColor: OFFICIAL_TIMETABLE_GEOMETRY.colors.theoryBg,
  }
}
