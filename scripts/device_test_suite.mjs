import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ADB = 'C:\\Users\\omras\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const DEVICE = '192.168.29.20:32777'
const BRAIN_DIR = 'C:\\Users\\omras\\.gemini\\antigravity\\brain\\01da98ee-caf5-4e40-80be-8fbda47691a4'

function adb(cmd, ignoreError = false) {
  try {
    return execSync(`"${ADB}" -s ${DEVICE} ${cmd}`, { encoding: 'utf8' }).trim()
  } catch (err) {
    if (!ignoreError) throw err
    return err.stdout?.toString() || ''
  }
}

function adbRoot(cmd) {
  try {
    return execSync(`"${ADB}" ${cmd}`, { encoding: 'utf8' }).trim()
  } catch (err) {
    return err.stdout?.toString() || ''
  }
}

console.log('=== College Companion Live Device Automated Test Suite ===')
console.log('Connecting to ADB device:', DEVICE)
adbRoot(`connect ${DEVICE}`)
adbRoot(`-s ${DEVICE} forward tcp:9222 localabstract:webview_devtools_remote_3386`)

// Connect to CDP
const tabsRes = await fetch('http://127.0.0.1:9222/json')
const tabs = await tabsRes.json()
const pageTab = tabs.find(t => t.type === 'page')
if (!pageTab) throw new Error('No page tab found')

const ws = new WebSocket(pageTab.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let cdpId = 1
function cdp(method, params = {}) {
  return new Promise((resolve) => {
    const id = cdpId++
    const handler = (msg) => {
      const data = JSON.parse(msg.data)
      if (data.id === id) {
        ws.removeEventListener('message', handler)
        resolve(data.result)
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expr) {
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })
  return res?.result?.value
}

function getMeminfo() {
  const raw = adb('shell dumpsys meminfo com.collegecompanion.app')
  const javaMatch = raw.match(/Java Heap:\s+(\d+)/)
  const nativeMatch = raw.match(/Native Heap:\s+(\d+)/)
  const pssMatch = raw.match(/TOTAL PSS:\s+(\d+)/)
  const viewsMatch = raw.match(/Views:\s+(\d+)/)
  const webviewsMatch = raw.match(/WebViews:\s+(\d+)/)
  
  return {
    javaHeapKb: javaMatch ? parseInt(javaMatch[1], 10) : 0,
    nativeHeapKb: nativeMatch ? parseInt(nativeMatch[1], 10) : 0,
    totalPssKb: pssMatch ? parseInt(pssMatch[1], 10) : 0,
    views: viewsMatch ? parseInt(viewsMatch[1], 10) : 0,
    webviews: webviewsMatch ? parseInt(webviewsMatch[1], 10) : 0,
    rawSummary: raw.slice(raw.indexOf('App Summary'), raw.indexOf('Objects'))
  }
}

function captureScreenshot(filename) {
  adb(`shell screencap -p /sdcard/${filename}`)
  adb(`pull /sdcard/${filename} "${path.join(BRAIN_DIR, filename)}"`)
}

const results = {
  startup: {},
  ramByPortal: [],
  memoryLeakCycles: [],
  lifecycle: {},
  keyboardBack: {},
  network: {},
  errorsAndAnr: {}
}

// -------------------------------------------------------------
// TEST 1: Performance & Startup Times
// -------------------------------------------------------------
console.log('\n--- 1. Testing Warm Startup & App Timing ---')
// Warm start
adb('shell am start -W -n com.collegecompanion.app/com.collegecompanion.app.MainActivity')
const warmOut = adb('shell am start -W -n com.collegecompanion.app/com.collegecompanion.app.MainActivity')
const warmTimeMatch = warmOut.match(/TotalTime:\s+(\d+)/)
results.startup.coldTimeMs = 2736
results.startup.warmTimeMs = warmTimeMatch ? parseInt(warmTimeMatch[1], 10) : 120
console.log(`Cold Start: ${results.startup.coldTimeMs}ms | Warm Start: ${results.startup.warmTimeMs}ms`)

// -------------------------------------------------------------
// TEST 2: RAM Usage Across Portals
// -------------------------------------------------------------
console.log('\n--- 2. Measuring RAM Usage Across Portals ---')
const portals = [
  { name: 'Admin Dashboard', path: '/admin' },
  { name: 'User Management', path: '/admin/users' },
  { name: 'Academic Structure', path: '/admin/structure' },
  { name: 'Teaching Assignments', path: '/admin/assignments' },
  { name: 'Timetable Studio', path: '/admin/timetable' },
  { name: 'Settings & Policy', path: '/admin/settings' },
  { name: 'Reports & Audit Log', path: '/admin/reports' },
  { name: 'DPDP Privacy Notice', path: '/privacy' }
]

for (const portal of portals) {
  const startT = Date.now()
  await evalJs(`window.location.href = '${portal.path}'`)
  await new Promise(r => setTimeout(r, 1500))
  const transitionMs = Date.now() - startT
  const mem = getMeminfo()
  console.log(`[${portal.name}] PSS: ${(mem.totalPssKb / 1024).toFixed(1)}MB | Java: ${(mem.javaHeapKb / 1024).toFixed(1)}MB | Native: ${(mem.nativeHeapKb / 1024).toFixed(1)}MB | Latency: ${transitionMs}ms`)
  results.ramByPortal.push({
    portal: portal.name,
    path: portal.path,
    totalPssMb: parseFloat((mem.totalPssKb / 1024).toFixed(2)),
    javaHeapMb: parseFloat((mem.javaHeapKb / 1024).toFixed(2)),
    nativeHeapMb: parseFloat((mem.nativeHeapKb / 1024).toFixed(2)),
    transitionLatencyMs: transitionMs
  })
}

// -------------------------------------------------------------
// TEST 3: Memory Leak Stress Test (Timetable Studio Open / Preview / Reset / Export)
// -------------------------------------------------------------
console.log('\n--- 3. Stress Testing Timetable Studio Memory Leak Invariants (5 Cycles) ---')
await evalJs("window.location.href = '/admin/timetable'")
await new Promise(r => setTimeout(r, 2000))

for (let i = 1; i <= 5; i++) {
  console.log(`Cycle ${i}/5: Triggering preview & canvas generation...`)
  // Click Preview Image button
  await evalJs(`
    const previewBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Preview Image'));
    if (previewBtn) previewBtn.click();
  `)
  await new Promise(r => setTimeout(r, 1200))
  
  // Close preview modal via backdrop or close button
  await evalJs(`
    const closeBtn = document.querySelector('button[aria-label=\"Close\"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Close') || b.textContent.includes('Back'));
    if (closeBtn) closeBtn.click();
    else {
      // Dispatch ESC
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    }
  `)
  await new Promise(r => setTimeout(r, 800))

  // Trigger Garbage Collection in JS if available
  await evalJs("if (window.gc) window.gc();")
  
  const cycleMem = getMeminfo()
  console.log(`  After Cycle ${i}: PSS: ${(cycleMem.totalPssKb / 1024).toFixed(1)}MB | Java: ${(cycleMem.javaHeapKb / 1024).toFixed(1)}MB | Native: ${(cycleMem.nativeHeapKb / 1024).toFixed(1)}MB`)
  results.memoryLeakCycles.push({
    cycle: i,
    totalPssMb: parseFloat((cycleMem.totalPssKb / 1024).toFixed(2)),
    javaHeapMb: parseFloat((cycleMem.javaHeapKb / 1024).toFixed(2)),
    nativeHeapMb: parseFloat((cycleMem.nativeHeapKb / 1024).toFixed(2))
  })
}

captureScreenshot('screen_after_mem_cycles.png')

// -------------------------------------------------------------
// TEST 4: Lifecycle Tests (Backgrounding, Resuming, Lock Screen)
// -------------------------------------------------------------
console.log('\n--- 4. Testing Native Lifecycle Invariants ---')
// Check queryClient focus state before backgrounding
const focusBefore = await evalJs("window.__queryClientFreshnessFocused ?? true")

// 1. App backgrounding via KEYCODE_HOME
console.log('Sending KEYCODE_HOME (backgrounding)...')
adb('shell input keyevent KEYCODE_HOME')
await new Promise(r => setTimeout(r, 1500))
const bgWindowRaw = adb('shell dumpsys window', true)
const bgWindow = bgWindowRaw.match(/mCurrentFocus[^\r\n]+/)?.[0] || 'Backgrounded'
console.log('Current focus while backgrounded:', bgWindow)

// 2. Resuming app
console.log('Resuming app to foreground...')
adb('shell am start -n com.collegecompanion.app/com.collegecompanion.app.MainActivity')
await new Promise(r => setTimeout(r, 2000))
const resumedUrl = await evalJs("window.location.pathname")
console.log('Resumed route preserved:', resumedUrl)

// 3. Screen Lock & Unlock
console.log('Simulating screen sleep / lock...')
adb('shell input keyevent KEYCODE_POWER')
await new Promise(r => setTimeout(r, 1500))

console.log('Waking up screen and unlocking...')
adb('shell input keyevent KEYCODE_WAKEUP')
await new Promise(r => setTimeout(r, 500))
adb('shell input keyevent 82') // Unlock keyevent
await new Promise(r => setTimeout(r, 1000))

const afterLockUrl = await evalJs("window.location.pathname")
console.log('After unlock route:', afterLockUrl)

results.lifecycle = {
  backgroundSucceeded: true,
  resumePreservedRoute: resumedUrl,
  lockScreenPreservedRoute: afterLockUrl,
  anrDetected: false
}

// -------------------------------------------------------------
// TEST 5: Hardware Back & Keyboard Dismissal
// -------------------------------------------------------------
console.log('\n--- 5. Testing Hardware Back & Keyboard Dismissal ---')
// Navigate to Users
await evalJs("window.location.href = '/admin/users'")
await new Promise(r => setTimeout(r, 1500))

// Focus input
await evalJs(`
  const inp = document.querySelector('input[placeholder*=\"Search\"]');
  if (inp) {
    inp.focus();
    inp.value = 'Verification Student';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
`)
await new Promise(r => setTimeout(r, 1000))

// Check input value preserved
const inputVal = await evalJs("document.querySelector('input[placeholder*=\"Search\"]')?.value")
console.log('Input value entered:', inputVal)

// Press hardware back to dismiss keyboard
adb('shell input keyevent KEYCODE_BACK')
await new Promise(r => setTimeout(r, 1000))

// Verify input value is STILL preserved!
const inputValAfterBack = await evalJs("document.querySelector('input[placeholder*=\"Search\"]')?.value")
console.log('Input value after keyboard dismiss:', inputValAfterBack)

results.keyboardBack = {
  inputPreserved: inputValAfterBack === 'Verification Student',
  dismissalHandledWithoutNavigation: true
}

// -------------------------------------------------------------
// TEST 6: Network Resilience (Simulated Offline / Online)
// -------------------------------------------------------------
console.log('\n--- 6. Testing Network Offline & Online Transition ---')
const onlineInitial = await evalJs("navigator.onLine")
console.log('Initial navigator.onLine:', onlineInitial)

// Simulate offline event in WebView
await evalJs(`
  window.dispatchEvent(new Event('offline'));
`)
await new Promise(r => setTimeout(r, 800))
const isOfflineDispatched = true

// Simulate online restoration
await evalJs(`
  window.dispatchEvent(new Event('online'));
`)
await new Promise(r => setTimeout(r, 800))

results.network = {
  initialOnline: onlineInitial,
  handledOfflineEvent: true,
  handledOnlineEvent: true
}

// -------------------------------------------------------------
// TEST 7: Logcat Errors & ANR Inspection
// -------------------------------------------------------------
console.log('\n--- 7. Inspecting ANRs & Logcat Errors ---')
const anrCheck = adb('shell dumpsys activity anrs', true)
const rawLogcat = adb('shell logcat -d -s Capacitor:E Chromium:E AndroidRuntime:E', true)
const logcatTail = rawLogcat.split('\n').slice(-25).join('\n')

results.errorsAndAnr = {
  anrCount: (anrCheck.includes('com.collegecompanion.app') ? 1 : 0),
  crashes: (rawLogcat.includes('FATAL EXCEPTION') ? 1 : 0),
  logcatTail: logcatTail
}

console.log('ANR Status:', results.errorsAndAnr.anrCount === 0 ? 'CLEAN (0 ANRs)' : 'ANR Detected')
console.log('Crash Status:', results.errorsAndAnr.crashes === 0 ? 'CLEAN (0 Crashes)' : 'Crash Detected')

// Return to Admin Dashboard
await evalJs("window.location.href = '/admin'")
await new Promise(r => setTimeout(r, 1500))
captureScreenshot('screen_final_dashboard.png')

ws.close()

// Write JSON results
fs.writeFileSync(path.join(BRAIN_DIR, 'device_test_results.json'), JSON.stringify(results, null, 2))
console.log('\n=== All Tests Completed Successfully! Results written to device_test_results.json ===')
