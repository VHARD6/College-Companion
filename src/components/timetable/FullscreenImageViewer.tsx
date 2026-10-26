import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ZoomIn, ZoomOut, RotateCcw, Download, Loader2 } from 'lucide-react'
import {
  calculateFitDimensions,
  calculatePanBounds,
  calculateDistance,
  calculateMidpoint,
  clamp,
  type Dimensions,
  type Point,
} from '../../lib/timetableGesture'

export interface FullscreenImageViewerProps {
  isOpen: boolean
  imageUrl: string
  title: string
  dateLabel?: string
  onClose: () => void
  onDownload?: () => void
  isDownloading?: boolean
}

export default function FullscreenImageViewer({
  isOpen,
  imageUrl,
  title,
  dateLabel,
  onClose,
  onDownload,
  isDownloading = false,
}: FullscreenImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Natural and fitted image dimensions
  const [naturalDimensions, setNaturalDimensions] = useState<Dimensions>({ width: 0, height: 0 })
  const [containerDimensions, setContainerDimensions] = useState<Dimensions>({ width: 0, height: 0 })

  // Transform state
  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  // Gesture tracking refs (avoids re-binding listener closures on every frame)
  const activePointersRef = useRef<Map<number, Point>>(new Map())
  const gestureStateRef = useRef<{
    startZoom: number
    startPan: Point
    startDistance: number
    startMidpoint: Point
    singleStartPoint: Point
    lastTapTime: number
  }>({
    startZoom: 1.0,
    startPan: { x: 0, y: 0 },
    startDistance: 0,
    startMidpoint: { x: 0, y: 0 },
    singleStartPoint: { x: 0, y: 0 },
    lastTapTime: 0,
  })

  // Measure container dimensions
  const updateContainerDimensions = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setContainerDimensions({
        width: Math.floor(rect.width),
        height: Math.floor(rect.height),
      })
    }
  }, [])

  // Lock background scroll when open
  useEffect(() => {
    if (!isOpen) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    updateContainerDimensions()
    window.addEventListener('resize', updateContainerDimensions)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('resize', updateContainerDimensions)
    }
  }, [isOpen, updateContainerDimensions])

  // Reset transform state when modal opens or image changes
  useEffect(() => {
    if (isOpen) {
      setZoom(1.0)
      setPan({ x: 0, y: 0 })
      activePointersRef.current.clear()
    }
  }, [isOpen, imageUrl])

  // Image onLoad handler to capture full natural resolution
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setNaturalDimensions({
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    })
    updateContainerDimensions()
  }

  // Calculate fitted dimensions within current container
  const fittedDimensions = calculateFitDimensions(containerDimensions, naturalDimensions)

  // Clamp pan based on current zoom and container bounds
  const clampPanToBounds = useCallback(
    (targetPan: Point, targetZoom: number): Point => {
      const bounds = calculatePanBounds(containerDimensions, fittedDimensions, targetZoom)
      return {
        x: clamp(targetPan.x, bounds.minX, bounds.maxX),
        y: clamp(targetPan.y, bounds.minY, bounds.maxY),
      }
    },
    [containerDimensions, fittedDimensions]
  )

  // Reset view to initial fitted state
  const handleReset = useCallback(() => {
    setZoom(1.0)
    setPan({ x: 0, y: 0 })
  }, [])

  // Step-wise zoom buttons for accessibility
  const handleZoomIn = () => {
    setZoom(prevZoom => {
      const nextZoom = clamp(prevZoom + 0.5, 1.0, 5.0)
      setPan(currentPan => clampPanToBounds(currentPan, nextZoom))
      return nextZoom
    })
  }

  const handleZoomOut = () => {
    setZoom(prevZoom => {
      const nextZoom = clamp(prevZoom - 0.5, 1.0, 5.0)
      if (nextZoom <= 1.01) {
        setPan({ x: 0, y: 0 })
        return 1.0
      }
      setPan(currentPan => clampPanToBounds(currentPan, nextZoom))
      return nextZoom
    })
  }

  // Pointer Down (Touch start / Mouse down)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return

    // Capture pointer to track outside bounds smoothly
    try {
      container.setPointerCapture(e.pointerId)
    } catch {
      // Ignore if pointer capture fails
    }

    const pointers = activePointersRef.current
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setIsDragging(true)

    const state = gestureStateRef.current
    state.startZoom = zoom
    state.startPan = { ...pan }

    if (pointers.size === 1) {
      state.singleStartPoint = { x: e.clientX, y: e.clientY }

      // Double-tap detection (<300ms between taps)
      const now = Date.now()
      if (now - state.lastTapTime < 300) {
        // Toggle zoom
        if (zoom > 1.2) {
          handleReset()
        } else {
          const newZoom = 2.5
          const newPan = clampPanToBounds({ x: 0, y: 0 }, newZoom)
          setZoom(newZoom)
          setPan(newPan)
        }
        state.lastTapTime = 0
        return
      }
      state.lastTapTime = now
    } else if (pointers.size === 2) {
      const [p1, p2] = Array.from(pointers.values())
      state.startDistance = calculateDistance(p1, p2)
      state.startMidpoint = calculateMidpoint(p1, p2)
    }
  }

  // Pointer Move (Touch drag / Pinch zoom)
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = activePointersRef.current
    if (!pointers.has(e.pointerId)) return

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const state = gestureStateRef.current

    if (pointers.size === 1) {
      // 1-finger Pan (only active when zoomed in beyond 1.0x)
      if (zoom > 1.01) {
        const deltaX = e.clientX - state.singleStartPoint.x
        const deltaY = e.clientY - state.singleStartPoint.y

        const nextPan = {
          x: state.startPan.x + deltaX,
          y: state.startPan.y + deltaY,
        }

        setPan(clampPanToBounds(nextPan, zoom))
      }
    } else if (pointers.size === 2) {
      // 2-finger Pinch Zoom + Pan
      const [p1, p2] = Array.from(pointers.values())
      const currentDistance = calculateDistance(p1, p2)

      if (state.startDistance > 0) {
        const pinchRatio = currentDistance / state.startDistance
        const nextZoom = clamp(state.startZoom * pinchRatio, 1.0, 5.0)

        // Midpoint translation during pinch
        const currentMidpoint = calculateMidpoint(p1, p2)
        const midDeltaX = currentMidpoint.x - state.startMidpoint.x
        const midDeltaY = currentMidpoint.y - state.startMidpoint.y

        const nextPan = {
          x: state.startPan.x + midDeltaX,
          y: state.startPan.y + midDeltaY,
        }

        setZoom(nextZoom)
        setPan(clampPanToBounds(nextPan, nextZoom))
      }
    }
  }

  // Pointer Up / Cancel / Leave
  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (container) {
      try {
        container.releasePointerCapture(e.pointerId)
      } catch {
        // Ignore
      }
    }

    const pointers = activePointersRef.current
    pointers.delete(e.pointerId)

    const state = gestureStateRef.current

    // If transitioned from 2 fingers to 1 finger, seamlessly continue pan without jumping
    if (pointers.size === 1) {
      const remainingPointer = Array.from(pointers.values())[0]
      state.singleStartPoint = { x: remainingPointer.x, y: remainingPointer.y }
      state.startPan = { ...pan }
      state.startZoom = zoom
    } else if (pointers.size === 0) {
      setIsDragging(false)
      state.startDistance = 0
      // Snap back to 0 if at minimum zoom
      if (zoom <= 1.01) {
        setZoom(1.0)
        setPan({ x: 0, y: 0 })
      }
    }
  }

  if (!isOpen) return null

  const isFitted = fittedDimensions.width > 0 && fittedDimensions.height > 0
  const zoomPercent = Math.round(zoom * 100)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col select-none touch-none"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* ─── Top Bar ─────────────────────────────────────────────────── */}
      <div className="relative z-20 flex items-center justify-between px-3 py-2.5 bg-black/80 border-b border-gray-800 text-white backdrop-blur-xs">
        <div className="min-w-0 pr-2">
          <h2 className="text-xs font-bold text-gray-100 truncate">{title}</h2>
          {dateLabel && <p className="text-[11px] text-gray-400 truncate">{dateLabel}</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={isDownloading}
              className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors active:scale-95"
              title="Download Timetable"
            >
              {isDownloading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              <span className="hidden sm:inline">Download</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            aria-label="Close fullscreen timetable"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* ─── Interactive Touch Viewport ──────────────────────────────── */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="relative flex-1 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
        style={{ touchAction: 'none' }}
      >
        <div
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: !isDragging ? 'transform 0.15s ease-out' : 'none',
            willChange: 'transform',
          }}
          className="flex items-center justify-center pointer-events-none"
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt={title}
            onLoad={handleImageLoad}
            style={{
              width: isFitted ? `${fittedDimensions.width}px` : 'auto',
              height: isFitted ? `${fittedDimensions.height}px` : 'auto',
              maxWidth: 'none',
              maxHeight: 'none',
              imageRendering: 'auto',
            }}
            className="shadow-2xl rounded-xs select-none object-contain"
            draggable={false}
          />
        </div>
      </div>

      {/* ─── Bottom Floating Zoom Controls ───────────────────────────── */}
      <div className="relative z-20 px-3 py-2 bg-black/80 border-t border-gray-800 flex items-center justify-between text-white backdrop-blur-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoom <= 1.01}
            className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800/80 text-gray-200 transition-colors"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>

          <span className="text-xs font-mono font-semibold text-gray-300 min-w-[48px] text-center">
            {zoomPercent}%
          </span>

          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoom >= 4.99}
            className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800/80 text-gray-200 transition-colors"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={16} />
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={zoom <= 1.01 && pan.x === 0 && pan.y === 0}
            className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-gray-800/80 hover:bg-gray-700 disabled:opacity-40 text-gray-300 transition-colors"
            title="Reset view"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>

        <span className="text-[10px] text-gray-400 hidden sm:inline">
          Pinch to zoom · Drag to pan · Double-tap to zoom
        </span>
      </div>
    </div>
  )
}
