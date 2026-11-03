import type { MasterTimetableGridData } from '../types/timetableMaker.ts'
import { formatCellContent, OFFICIAL_TIMETABLE_GEOMETRY } from './timetableCellFormatter.ts'

let cachedLogoPromise: Promise<HTMLImageElement | null> | null = null

/**
 * Loads an image from a URL or data path safely into an HTMLImageElement.
 * Caches the institutional logo to prevent repeated decoding and listener closure leaks.
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (src === '/mes_logo.png') {
    if (!cachedLogoPromise) {
      cachedLogoPromise = new Promise(resolve => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          img.onload = null
          img.onerror = null
          resolve(img)
        }
        img.onerror = () => {
          img.onload = null
          img.onerror = null
          resolve(null)
        }
        img.src = src
      })
    }
    return cachedLogoPromise
  }

  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      img.onload = null
      img.onerror = null
      resolve(img)
    }
    img.onerror = () => {
      img.onload = null
      img.onerror = null
      resolve(null)
    }
    img.src = src
  })
}

/**
 * Helper to stroke crisp lines on canvas (avoiding half-pixel blur).
 */
function strokeLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineWidth = 1.5,
  color = '#000000'
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(Math.floor(x1) + 0.5, Math.floor(y1) + 0.5)
  ctx.lineTo(Math.floor(x2) + 0.5, Math.floor(y2) + 0.5)
  ctx.stroke()
  ctx.restore()
}

/**
 * Renders the official College Master Timetable onto an HTML5 Canvas.
 * Produces an exact reproduction of the college master timetable reference image.
 */
export async function renderTimetableToCanvas(
  grid: MasterTimetableGridData,
  canvas: HTMLCanvasElement,
  scale = 2
): Promise<void> {
  const baseWidth = 1100
  const leftMargin = 15
  const rightMargin = baseWidth - 15
  const contentWidth = rightMargin - leftMargin

  // Fixed column widths based strictly on the official reference geometry:
  // Time column: 174 / 900 = 19.333%
  const colTimeWidth = Math.round(contentWidth * OFFICIAL_TIMETABLE_GEOMETRY.timeColRatio)
  const branchColWidth = (contentWidth - colTimeWidth) / grid.branches.length

  const getColX = (colIndex: number) => leftMargin + colTimeWidth + colIndex * branchColWidth

  // Compute total layout height dynamically
  const headerTop = 15
  const headerHeight = 150
  const barTop = headerTop + headerHeight
  const barHeight = 28
  const metaTop = barTop + barHeight
  const metaHeight = 60
  const gridTop = metaTop + metaHeight
  const gridHeaderHeight = 30
  const periodRowHeight = 44

  const totalGridHeight = gridHeaderHeight + grid.periods.length * periodRowHeight
  const gridBottom = gridTop + totalGridHeight

  const coordTop = gridBottom + 16
  const coordHeaderHeight = 24
  const coordRowHeight = 36
  const coordBottom = coordTop + coordHeaderHeight + coordRowHeight

  const noteTop = coordBottom + 14
  const noteHeight = 52
  const noteBottom = noteTop + noteHeight

  const baseHeight = noteBottom + 18

  canvas.width = baseWidth * scale
  canvas.height = baseHeight * scale

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get canvas context')

  ctx.scale(scale, scale)

  // 1. Clear background to pure white
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, baseWidth, baseHeight)

  // ─── SECTION 1: INSTITUTIONAL HEADER BOX ─────────────────────────
  const headerBottom = barTop
  const logoWidth = colTimeWidth // Aligns with Time column!
  const headerTextLeft = leftMargin + logoWidth

  // Outer border of header box
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1.5
  ctx.strokeRect(leftMargin, headerTop, contentWidth, headerHeight)

  // Dividing line between logo and text
  strokeLine(ctx, headerTextLeft, headerTop, headerTextLeft, headerBottom, 1.5)

  // Draw Logo in left box
  const logoImg = await loadImage('/mes_logo.png')
  if (logoImg) {
    const pad = 10
    ctx.drawImage(logoImg, leftMargin + pad, headerTop + pad, logoWidth - pad * 2, headerHeight - pad * 2)
  } else {
    // Fallback crest representation
    ctx.fillStyle = '#1e3a8a'
    ctx.font = 'bold 14px "Times New Roman", Times, serif'
    ctx.textAlign = 'center'
    ctx.fillText('MES', leftMargin + logoWidth / 2, headerTop + 65)
    ctx.fillText('PUNE 1860', leftMargin + logoWidth / 2, headerTop + 85)
  }

  // Draw Header text (matching exact 5-line typography of reference)
  const textCenterX = headerTextLeft + (contentWidth - logoWidth) / 2
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'

  ctx.font = 'bold 15px "Times New Roman", Times, serif'
  ctx.fillText("MAHARASHTRA EDUCATION SOCIETY'S", textCenterX, headerTop + 32)

  ctx.font = 'bold 18.5px "Times New Roman", Times, serif'
  ctx.fillText('MUKUNDDAS LOHIA COLLEGE OF ENGINEERING, PUNE', textCenterX, headerTop + 58)

  ctx.font = '12px "Times New Roman", Times, serif'
  ctx.fillText(
    '(Approved by AICTE, Recognized by Govt. of Maharashtra and',
    textCenterX,
    headerTop + 84
  )
  ctx.fillText(
    'Affiliated to Dr. Babasaheb Ambedkar Technological University',
    textCenterX,
    headerTop + 102
  )
  ctx.fillText(
    '(DBATU), Lonere)',
    textCenterX,
    headerTop + 120
  )

  // ─── SECTION 2: "Master Time Table" BAR ───────────────────────────
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.masterTimeTableBarBg
  ctx.fillRect(leftMargin, barTop, contentWidth, barHeight)
  ctx.strokeRect(leftMargin, barTop, contentWidth, barHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 16.5px "Times New Roman", Times, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Master Time Table', leftMargin + contentWidth / 2, barTop + 19)

  // ─── SECTION 3: METADATA LINES ────────────────────────────────────
  ctx.strokeRect(leftMargin, metaTop, contentWidth, metaHeight)

  // Line 1: A. Y. and SEM
  ctx.font = 'bold 16px "Times New Roman", Times, serif'
  ctx.textAlign = 'left'
  ctx.fillText(`A. Y.: ${grid.academicYear || '2026-27'}`, leftMargin + 12, metaTop + 24)

  ctx.textAlign = 'right'
  ctx.fillText(`SEM: ${grid.semester || 'I'}`, rightMargin - 12, metaTop + 24)

  // Line 2: Class and Date (Date in bold RED!)
  const displayClass = grid.className === 'FY BTECH' ? 'F.Y. B.TECH.' : (grid.className || 'F.Y. B.TECH.')
  ctx.textAlign = 'left'
  ctx.font = 'bold 17px "Times New Roman", Times, serif'
  ctx.fillText(`Class: ${displayClass}`, leftMargin + 12, metaTop + 50)

  ctx.textAlign = 'right'
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.dateRed // Official College Red (#BB1821)
  ctx.font = 'bold 17px "Times New Roman", Times, serif'
  ctx.fillText(`Date: ${grid.date || '02/11/2026'}`, rightMargin - 12, metaTop + 50)
  ctx.fillStyle = '#000000' // Reset to black

  // ─── SECTION 4: MAIN TIMETABLE GRID ───────────────────────────────
  // Grid Header Row
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.gridHeaderBg
  ctx.fillRect(leftMargin, gridTop, contentWidth, gridHeaderHeight)
  ctx.strokeRect(leftMargin, gridTop, contentWidth, gridHeaderHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 13.5px "Times New Roman", Times, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Time', leftMargin + colTimeWidth / 2, gridTop + 20)
  strokeLine(ctx, leftMargin + colTimeWidth, gridTop, leftMargin + colTimeWidth, gridTop + gridHeaderHeight)

  grid.branches.forEach((b, idx) => {
    const colX = getColX(idx)
    ctx.fillText(b, colX + branchColWidth / 2, gridTop + 20)
    strokeLine(ctx, colX + branchColWidth, gridTop, colX + branchColWidth, gridTop + gridHeaderHeight)
  })

  // Grid Data Rows
  let currentY = gridTop + gridHeaderHeight
  const periodTops = new Map<number, number>()

  grid.periods.forEach(p => {
    periodTops.set(p.id, currentY)
    currentY += periodRowHeight
  })

  // Draw grid outer border
  ctx.strokeRect(leftMargin, gridTop, contentWidth, gridBottom - gridTop)

  // Track spanned cells so child periods don't re-render them
  const coveredCells = new Set<string>()

  // Draw each period row
  grid.periods.forEach(period => {
    const pY = periodTops.get(period.id)!

    // Full Break Row (e.g. Short Break or Long Break)
    if (period.isBreak) {
      ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.breakRowBg
      ctx.fillRect(leftMargin, pY, contentWidth, periodRowHeight)
      strokeLine(ctx, leftMargin, pY + periodRowHeight, rightMargin, pY + periodRowHeight)
      strokeLine(ctx, leftMargin + colTimeWidth, pY, leftMargin + colTimeWidth, pY + periodRowHeight)

      ctx.fillStyle = '#000000'
      ctx.font = 'bold 13.5px "Times New Roman", Times, serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${period.startTime}-${period.endTime}`, leftMargin + colTimeWidth / 2, pY + 27)

      ctx.font = 'bold 14.5px "Times New Roman", Times, serif'
      ctx.fillText(
        period.breakLabel || 'Break',
        leftMargin + colTimeWidth + (contentWidth - colTimeWidth) / 2,
        pY + 27
      )
      return
    }

    // Time cell
    strokeLine(ctx, leftMargin, pY + periodRowHeight, rightMargin, pY + periodRowHeight)
    strokeLine(ctx, leftMargin + colTimeWidth, pY, leftMargin + colTimeWidth, pY + periodRowHeight)

    ctx.fillStyle = '#000000'
    ctx.font = 'bold 13.5px "Times New Roman", Times, serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${period.startTime} - ${period.endTime}`, leftMargin + colTimeWidth / 2, pY + 27)

    // Branch cells
    grid.branches.forEach((_branch, bIdx) => {
      const cellKey = `${period.id}_${bIdx}`
      if (coveredCells.has(cellKey)) return

      const cellX = getColX(bIdx)
      const cell = grid.cells[cellKey]

      let cellHeight = periodRowHeight
      const rowSpan = cell?.rowSpan || 1
      if (rowSpan > 1) {
        cellHeight = periodRowHeight * rowSpan
        for (let s = 0; s < rowSpan; s++) {
          coveredCells.add(`${period.id + s}_${bIdx}`)
        }
      }

      const formatted = formatCellContent(cell, period.id)

      // Fill cell background & border
      ctx.fillStyle = formatted.bgColor
      ctx.fillRect(cellX, pY, branchColWidth, cellHeight)
      ctx.strokeRect(cellX, pY, branchColWidth, cellHeight)

      // Render cell text
      ctx.fillStyle = '#000000'

      if (formatted.isDash) {
        ctx.font = 'bold 16px "Times New Roman", Times, serif'
        ctx.textAlign = 'center'
        ctx.fillText('-', cellX + branchColWidth / 2, pY + cellHeight / 2 + 5)
      } else if (formatted.isBatchSplit) {
        // Multi-batch practical (numbered lines: 1. ... / 2. ...) - centered!
        ctx.font = 'bold 11.5px "Times New Roman", Times, serif'
        ctx.textAlign = 'center'
        const lineSpacing = 16
        const startY = pY + cellHeight / 2 - lineSpacing / 2 + 3
        formatted.lines.forEach((line, lIdx) => {
          ctx.fillText(line, cellX + branchColWidth / 2, startY + lIdx * lineSpacing)
        })
      } else {
        // Theory lecture or single practical
        ctx.font = 'bold 12.5px "Times New Roman", Times, serif'
        ctx.textAlign = 'center'
        const lineCount = formatted.lines.length
        if (lineCount === 1) {
          ctx.fillText(formatted.lines[0], cellX + branchColWidth / 2, pY + cellHeight / 2 + 4)
        } else if (lineCount === 2) {
          ctx.fillText(formatted.lines[0], cellX + branchColWidth / 2, pY + cellHeight / 2 - 4)
          ctx.fillText(formatted.lines[1], cellX + branchColWidth / 2, pY + cellHeight / 2 + 13)
        } else {
          const startY = pY + cellHeight / 2 - (lineCount - 1) * 8
          formatted.lines.forEach((line, lIdx) => {
            ctx.fillText(line, cellX + branchColWidth / 2, startY + lIdx * 16)
          })
        }
      }
    })
  })

  // ─── SECTION 5: CLASS COORDINATORS TABLE ──────────────────────────
  const coordCol0Width = colTimeWidth // Aligns with Time column
  const coordBranchWidth = branchColWidth // Aligns with branch columns

  // Header row
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.coordinatorHeaderBg
  ctx.fillRect(leftMargin, coordTop, contentWidth, coordHeaderHeight)
  ctx.strokeRect(leftMargin, coordTop, contentWidth, coordHeaderHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 13px "Times New Roman", Times, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Branch', leftMargin + coordCol0Width / 2, coordTop + 17)
  strokeLine(ctx, leftMargin + coordCol0Width, coordTop, leftMargin + coordCol0Width, coordTop + coordHeaderHeight)

  grid.branches.forEach((b, idx) => {
    const colX = leftMargin + coordCol0Width + idx * coordBranchWidth
    ctx.fillText(b, colX + coordBranchWidth / 2, coordTop + 17)
    strokeLine(ctx, colX + coordBranchWidth, coordTop, colX + coordBranchWidth, coordTop + coordHeaderHeight)
  })

  // Content row
  const coordContentY = coordTop + coordHeaderHeight
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.coordinatorLabelBg
  ctx.fillRect(leftMargin, coordContentY, coordCol0Width, coordRowHeight)
  ctx.strokeRect(leftMargin, coordContentY, coordCol0Width, coordRowHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 12px "Times New Roman", Times, serif'
  ctx.textAlign = 'center'
  ctx.fillText('FE Class Coordinators', leftMargin + coordCol0Width / 2, coordContentY + coordRowHeight / 2 + 4)

  grid.coordinators.forEach((coord, idx) => {
    const colX = leftMargin + coordCol0Width + idx * coordBranchWidth
    ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.coordinatorContentBg
    ctx.fillRect(colX, coordContentY, coordBranchWidth, coordRowHeight)
    ctx.strokeRect(colX, coordContentY, coordBranchWidth, coordRowHeight)

    ctx.fillStyle = '#000000'
    ctx.font = 'bold 12px "Times New Roman", Times, serif'
    ctx.textAlign = 'center'

    const parts = coord.name.split(' ')
    if (parts.length >= 3) {
      ctx.fillText(`${parts[0]} ${parts[1]}`, colX + coordBranchWidth / 2, coordContentY + coordRowHeight / 2 - 4)
      ctx.fillText(parts.slice(2).join(' '), colX + coordBranchWidth / 2, coordContentY + coordRowHeight / 2 + 12)
    } else {
      ctx.fillText(coord.name, colX + coordBranchWidth / 2, coordContentY + coordRowHeight / 2 + 4)
    }
  })

  // ─── SECTION 6: PRACTICAL SESSION NOTE BOX ────────────────────────
  const noteLabelWidth = Math.round(contentWidth * OFFICIAL_TIMETABLE_GEOMETRY.noteLeftRatio)

  // Left Note Box
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.noteLeftBg
  ctx.fillRect(leftMargin, noteTop, noteLabelWidth, noteHeight)
  ctx.strokeRect(leftMargin, noteTop, noteLabelWidth, noteHeight)
  ctx.fillStyle = '#000000'
  ctx.font = 'bold 15px "Times New Roman", Times, serif'
  ctx.textAlign = 'left'
  ctx.fillText('Note: For Practical Session:', leftMargin + 14, noteTop + 31)

  // Right Note Table (Batches 1 & 2)
  const batchTableX = leftMargin + noteLabelWidth
  const batchTableWidth = contentWidth - noteLabelWidth
  const batchCol1Width = Math.round(batchTableWidth * OFFICIAL_TIMETABLE_GEOMETRY.noteBatchLabelRatio)
  const halfHeight = noteHeight / 2

  // Batch 1 row
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.noteBatchLabelBg
  ctx.fillRect(batchTableX, noteTop, batchCol1Width, halfHeight)
  ctx.strokeRect(batchTableX, noteTop, batchCol1Width, halfHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 13px "Times New Roman", Times, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Batch 1:', batchTableX + batchCol1Width / 2, noteTop + 17)

  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.noteRightBatchBg
  ctx.fillRect(batchTableX + batchCol1Width, noteTop, batchTableWidth - batchCol1Width, halfHeight)
  ctx.strokeRect(batchTableX + batchCol1Width, noteTop, batchTableWidth - batchCol1Width, halfHeight)

  ctx.fillStyle = '#000000'
  ctx.textAlign = 'left'
  ctx.font = 'bold 13px "Times New Roman", Times, serif'
  ctx.fillText(
    grid.practicalNotes?.batch1Roll || 'Roll No. 1 to 33.',
    batchTableX + batchCol1Width + 12,
    noteTop + 17
  )

  // Batch 2 row
  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.noteBatchLabelBg
  ctx.fillRect(batchTableX, noteTop + halfHeight, batchCol1Width, halfHeight)
  ctx.strokeRect(batchTableX, noteTop + halfHeight, batchCol1Width, halfHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 13px "Times New Roman", Times, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Batch 2:', batchTableX + batchCol1Width / 2, noteTop + halfHeight + 17)

  ctx.fillStyle = OFFICIAL_TIMETABLE_GEOMETRY.colors.noteRightBatchBg
  ctx.fillRect(batchTableX + batchCol1Width, noteTop + halfHeight, batchTableWidth - batchCol1Width, halfHeight)
  ctx.strokeRect(batchTableX + batchCol1Width, noteTop + halfHeight, batchTableWidth - batchCol1Width, halfHeight)

  ctx.fillStyle = '#000000'
  ctx.textAlign = 'left'
  ctx.font = 'bold 13px "Times New Roman", Times, serif'
  ctx.fillText(
    grid.practicalNotes?.batch2Roll || 'Roll no. 34 & Onwords.',
    batchTableX + batchCol1Width + 12,
    noteTop + halfHeight + 17
  )
}

/**
 * Renders the timetable grid into an offscreen canvas and returns a high-res PNG Blob.
 */
export async function renderTimetableToBlob(
  grid: MasterTimetableGridData,
  scale = 2
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  try {
    await renderTimetableToCanvas(grid, canvas, scale)
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob conversion failed'))
      }, 'image/png')
    })
  } finally {
    // Release large canvas bitmap buffer from browser/GPU memory immediately
    canvas.width = 0
    canvas.height = 0
  }
}

/**
 * Renders the timetable grid into an offscreen canvas and returns a PNG Data URL.
 */
export async function renderTimetableToDataUrl(
  grid: MasterTimetableGridData,
  scale = 2
): Promise<string> {
  const canvas = document.createElement('canvas')
  try {
    await renderTimetableToCanvas(grid, canvas, scale)
    return canvas.toDataURL('image/png')
  } finally {
    // Release large canvas bitmap buffer from browser/GPU memory immediately
    canvas.width = 0
    canvas.height = 0
  }
}
