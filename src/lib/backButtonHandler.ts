/**
 * Hardware back button dispatch registry for mobile and native runtime.
 * Allows components (such as MarkAttendancePage) to intercept back actions,
 * close open dialogs, step backward through multi-step wizards, or guard unsaved changes.
 */

export type HardwareBackHandler = () => boolean

const handlers: HardwareBackHandler[] = []

/**
 * Registers a hardware back button handler.
 * Handlers are executed in LIFO (last-in, first-out) order (stack).
 * If a handler returns `true`, it has consumed the back event and no further handlers
 * or default navigation will be executed.
 * If it returns `false`, the event falls through to the next handler or default navigation.
 * Returns an unregister function to call on unmount.
 */
export function registerHardwareBackHandler(handler: HardwareBackHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) {
      handlers.splice(index, 1)
    }
  }
}

/**
 * Dispatches a hardware back event to registered handlers.
 * Returns true if any handler consumed the event, false otherwise.
 */
export function dispatchHardwareBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    const handled = handlers[i]()
    if (handled) {
      return true
    }
  }
  return false
}

/**
 * Clears all registered handlers. Useful for test isolation.
 */
export function clearHardwareBackHandlers(): void {
  handlers.length = 0
}
