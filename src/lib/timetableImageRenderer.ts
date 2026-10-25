import type { MasterTimetableGridData } from '../types/timetableMaker.ts'

/**
 * Loads an image from a URL or data path safely into an HTMLImageElement.
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
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
  const baseHeight = 920

  canvas.width = baseWidth * scale
  canvas.height = baseHeight * scale

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get canvas context')

  ctx.scale(scale, scale)

  // 1. Clear background to pure white
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, baseWidth, baseHeight)

  const leftMargin = 15
  const rightMargin = baseWidth - 15
  const contentWidth = rightMargin - leftMargin

  // ─── SECTION 1: INSTITUTIONAL HEADER BOX ─────────────────────────
  const headerTop = 15
  const headerHeight = 145
  const headerBottom = headerTop + headerHeight
  const logoWidth = 150
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
    const pad = 8
    ctx.drawImage(logoImg, leftMargin + pad, headerTop + pad, logoWidth - pad * 2, headerHeight - pad * 2)
  } else {
    // Fallback crest representation
    ctx.fillStyle = '#1e3a8a'
    ctx.font = 'bold 12px serif'
    ctx.textAlign = 'center'
    ctx.fillText('MES', leftMargin + logoWidth / 2, headerTop + 65)
    ctx.fillText('PUNE 1860', leftMargin + logoWidth / 2, headerTop + 85)
  }

  // Draw Header text
  const textCenterX = headerTextLeft + (contentWidth - logoWidth) / 2
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'

  ctx.font = 'bold 16px "Times New Roman", Times, serif'
  ctx.fillText("MAHARASHTRA EDUCATION SOCIETY'S", textCenterX, headerTop + 35)

  ctx.font = 'bold 19px "Times New Roman", Times, serif'
  ctx.fillText('MUKUNDDAS LOHIA COLLEGE OF ENGINEERING, PUNE', textCenterX, headerTop + 64)

  ctx.font = '12px "Times New Roman", Times, serif'
  ctx.fillText('(Approved by AICTE, Recognized by Govt. of Maharashtra and Affiliated', textCenterX, headerTop + 90)
  ctx.fillText('to Dr. Babasaheb Ambedkar Technological University (DBATU), Lonere)', textCenterX, headerTop + 110)

  // ─── SECTION 2: "Master Time Table" BAR ───────────────────────────
  const barTop = headerBottom
  const barHeight = 28
  const barBottom = barTop + barHeight

  ctx.fillStyle = '#D9D9D9'
  ctx.fillRect(leftMargin, barTop, contentWidth, barHeight)
  ctx.strokeRect(leftMargin, barTop, contentWidth, barHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 16px "Times New Roman", Times, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Master Time Table', leftMargin + contentWidth / 2, barTop + 20)

  // ─── SECTION 3: METADATA LINES ────────────────────────────────────
  const metaTop = barBottom
  const metaHeight = 65
  const metaBottom = metaTop + metaHeight

  ctx.strokeRect(leftMargin, metaTop, contentWidth, metaHeight)

  // Line 1: A. Y. and SEM
  ctx.font = 'bold 17px "Times New Roman", Times, serif'
  ctx.textAlign = 'left'
  ctx.fillText(`A. Y.: ${grid.academicYear || '2026-27'}`, leftMargin + 10, metaTop + 26)

  ctx.textAlign = 'right'
  ctx.fillText(`SEM: ${grid.semester || 'I'}`, rightMargin - 10, metaTop + 26)

  // Line 2: Class and Date (Date in bold RED!)
  ctx.textAlign = 'left'
  ctx.font = 'bold 18px "Times New Roman", Times, serif'
  ctx.fillText(`Class: ${grid.className || 'FY BTECH'}`, leftMargin + 10, metaTop + 54)

  ctx.textAlign = 'right'
  ctx.fillStyle = '#D00000' // Official College Red
  ctx.font = 'bold 18px "Times New Roman", Times, serif'
  ctx.fillText(`Date: ${grid.date || '22/10/2026'}`, rightMargin - 10, metaTop + 54)
  ctx.fillStyle = '#000000' // Reset to black

  // ─── SECTION 4: MAIN TIMETABLE GRID ───────────────────────────────
  const gridTop = metaBottom
  const colTimeWidth = 150
  const branchColWidth = (contentWidth - colTimeWidth) / grid.branches.length

  const getColX = (colIndex: number) => leftMargin + colTimeWidth + colIndex * branchColWidth

  // Grid Header Row
  const gridHeaderHeight = 30
  ctx.fillStyle = '#C7DDB5' // Soft Sage Green
  ctx.fillRect(leftMargin, gridTop, contentWidth, gridHeaderHeight)
  ctx.strokeRect(leftMargin, gridTop, contentWidth, gridHeaderHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 12px Arial, sans-serif'
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
  const periodRowHeight = 44
  const periodTops = new Map<number, number>()

  grid.periods.forEach(p => {
    periodTops.set(p.id, currentY)
    currentY += periodRowHeight
  })

  const gridBottom = currentY

  // Draw grid outer border
  ctx.strokeRect(leftMargin, gridTop, contentWidth, gridBottom - gridTop)

  // Track spanned cells so child periods don't re-render them
  const coveredCells = new Set<string>()

  // Draw each period row
  grid.periods.forEach(period => {
    const pY = periodTops.get(period.id)!

    // Time cell
    strokeLine(ctx, leftMargin, pY + periodRowHeight, rightMargin, pY + periodRowHeight)
    strokeLine(ctx, leftMargin + colTimeWidth, pY, leftMargin + colTimeWidth, pY + periodRowHeight)

    ctx.fillStyle = '#000000'
    ctx.font = 'bold 12px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${period.startTime} - ${period.endTime}`, leftMargin + colTimeWidth / 2, pY + 26)

    // Full Break Row (e.g. Short Break or Long Break)
    if (period.isBreak) {
      ctx.fillStyle = '#DCD6EB' // Soft Lavender
      ctx.fillRect(leftMargin + colTimeWidth, pY, contentWidth - colTimeWidth, periodRowHeight)
      strokeLine(ctx, leftMargin + colTimeWidth, pY, rightMargin, pY)

      ctx.fillStyle = '#000000'
      ctx.font = 'bold 14px "Times New Roman", Times, serif'
      ctx.textAlign = 'center'
      ctx.fillText(
        period.breakLabel || 'Break',
        leftMargin + colTimeWidth + (contentWidth - colTimeWidth) / 2,
        pY + 27
      )
      return
    }

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

      // Fill cell background & border
      if (cell?.type === 'practical') {
        ctx.fillStyle = '#FAD2D2' // Soft Peach/Pink for Practicals
        ctx.fillRect(cellX, pY, branchColWidth, cellHeight)
      } else if (cell?.type === 'empty') {
        ctx.fillStyle = '#EDE9F6' // Subtle light tint for free slots
        ctx.fillRect(cellX, pY, branchColWidth, cellHeight)
      } else {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(cellX, pY, branchColWidth, cellHeight)
      }

      // Cell borders
      ctx.strokeRect(cellX, pY, branchColWidth, cellHeight)

      // Render cell text
      ctx.fillStyle = '#000000'
      if (!cell || cell.type === 'empty') {
        ctx.font = 'bold 14px Arial, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('-', cellX + branchColWidth / 2, pY + cellHeight / 2 + 5)
      } else if (cell.type === 'practical') {
        // Multi-period practical or batch-split practical
        if (cell.batch1 && cell.batch2) {
          ctx.font = 'bold 10px Arial, sans-serif'
          ctx.textAlign = 'left'
          ctx.fillText(`1.${cell.batch1.subject} [${cell.batch1.profAbbr}] [${cell.batch1.room}]`, cellX + 6, pY + 16)
          ctx.fillText(`2. ${cell.batch2.subject} [${cell.batch2.profAbbr}] [${cell.batch2.room}]`, cellX + 6, pY + 32)
        } else {
          ctx.font = 'bold 11px Arial, sans-serif'
          ctx.textAlign = 'center'
          const lines = (cell.text || `${cell.subject} [${cell.professorAbbr}] Practical\n[${cell.room}]`).split('\n')
          const startY = pY + cellHeight / 2 - (lines.length - 1) * 8
          lines.forEach((line, lIdx) => {
            ctx.fillText(line, cellX + branchColWidth / 2, startY + lIdx * 17)
          })
        }
      } else {
        // Theory Lecture
        ctx.font = 'bold 11px Arial, sans-serif'
        ctx.textAlign = 'center'
        const subjText = cell.subject ? `${cell.subject} [${cell.professorAbbr || ''}] [${cell.room || ''}]` : (cell.text || '-')
        ctx.fillText(subjText, cellX + branchColWidth / 2, pY + cellHeight / 2 + 4)
      }
    })
  })

  // ─── SECTION 5: CLASS COORDINATORS TABLE ──────────────────────────
  const coordTop = gridBottom + 18
  const coordHeaderHeight = 24
  const coordRowHeight = 28
  const coordCol0Width = 160
  const coordBranchWidth = (contentWidth - coordCol0Width) / grid.branches.length

  // Header row
  ctx.fillStyle = '#DCD6EB' // Soft Lavender
  ctx.fillRect(leftMargin, coordTop, contentWidth, coordHeaderHeight)
  ctx.strokeRect(leftMargin, coordTop, contentWidth, coordHeaderHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 12px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Branch', leftMargin + coordCol0Width / 2, coordTop + 16)
  strokeLine(ctx, leftMargin + coordCol0Width, coordTop, leftMargin + coordCol0Width, coordTop + coordHeaderHeight)

  grid.branches.forEach((b, idx) => {
    const colX = leftMargin + coordCol0Width + idx * coordBranchWidth
    ctx.fillText(b, colX + coordBranchWidth / 2, coordTop + 16)
    strokeLine(ctx, colX + coordBranchWidth, coordTop, colX + coordBranchWidth, coordTop + coordHeaderHeight)
  })

  // Content row
  const coordContentY = coordTop + coordHeaderHeight
  ctx.strokeRect(leftMargin, coordContentY, contentWidth, coordRowHeight)
  strokeLine(ctx, leftMargin + coordCol0Width, coordContentY, leftMargin + coordCol0Width, coordContentY + coordRowHeight)

  ctx.font = 'bold 11px Arial, sans-serif'
  ctx.fillText('FE Class Coordinators', leftMargin + coordCol0Width / 2, coordContentY + 18)

  grid.coordinators.forEach((coord, idx) => {
    const colX = leftMargin + coordCol0Width + idx * coordBranchWidth
    strokeLine(ctx, colX + coordBranchWidth, coordContentY, colX + coordBranchWidth, coordContentY + coordRowHeight)
    ctx.font = 'bold 11px Arial, sans-serif'
    ctx.fillText(coord.name, colX + coordBranchWidth / 2, coordContentY + 18)
  })

  // ─── SECTION 6: PRACTICAL SESSION NOTE BOX ────────────────────────
  const noteTop = coordContentY + coordRowHeight + 15
  const noteHeight = 50
  const noteLabelWidth = 350

  // Left Note Box
  ctx.strokeRect(leftMargin, noteTop, noteLabelWidth, noteHeight)
  ctx.font = 'bold 16px "Times New Roman", Times, serif'
  ctx.textAlign = 'left'
  ctx.fillText('Note: For Practical Session:', leftMargin + 10, noteTop + 32)

  // Right Note Table (Batches 1 & 2)
  const batchTableX = leftMargin + noteLabelWidth
  const batchTableWidth = contentWidth - noteLabelWidth
  const batchCol1Width = 140
  const halfHeight = noteHeight / 2

  // Batch 1 row
  ctx.fillStyle = '#CFE2F3' // Soft light blue
  ctx.fillRect(batchTableX, noteTop, batchTableWidth, halfHeight)
  ctx.strokeRect(batchTableX, noteTop, batchTableWidth, halfHeight)
  strokeLine(ctx, batchTableX + batchCol1Width, noteTop, batchTableX + batchCol1Width, noteTop + halfHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 12px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Batch 1:', batchTableX + batchCol1Width / 2, noteTop + 17)

  ctx.textAlign = 'left'
  ctx.font = '12px Arial, sans-serif'
  ctx.fillText(grid.practicalNotes?.batch1Roll || 'Roll No. 1 to 33.', batchTableX + batchCol1Width + 10, noteTop + 17)

  // Batch 2 row
  ctx.fillStyle = '#CFE2F3'
  ctx.fillRect(batchTableX, noteTop + halfHeight, batchTableWidth, halfHeight)
  ctx.strokeRect(batchTableX, noteTop + halfHeight, batchTableWidth, halfHeight)
  strokeLine(ctx, batchTableX + batchCol1Width, noteTop + halfHeight, batchTableX + batchCol1Width, noteTop + noteHeight)

  ctx.fillStyle = '#000000'
  ctx.font = 'bold 12px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Batch 2:', batchTableX + batchCol1Width / 2, noteTop + halfHeight + 17)

  ctx.textAlign = 'left'
  ctx.font = '12px Arial, sans-serif'
  ctx.fillText(grid.practicalNotes?.batch2Roll || 'Roll no. 34 & Onwords.', batchTableX + batchCol1Width + 10, noteTop + halfHeight + 17)
}

/**
 * Renders the timetable grid into an offscreen canvas and returns a high-res PNG Blob.
 */
export async function renderTimetableToBlob(
  grid: MasterTimetableGridData,
  scale = 2
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  await renderTimetableToCanvas(grid, canvas, scale)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas toBlob conversion failed'))
    }, 'image/png')
  })
}

/**
 * Renders the timetable grid into an offscreen canvas and returns a PNG Data URL.
 */
export async function renderTimetableToDataUrl(
  grid: MasterTimetableGridData,
  scale = 2
): Promise<string> {
  const canvas = document.createElement('canvas')
  await renderTimetableToCanvas(grid, canvas, scale)
  return canvas.toDataURL('image/png')
}
