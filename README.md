# College Companion 🎓

**College Companion** is an enterprise-grade, mobile-first academic attendance and college management application built with **React 19, TypeScript, Vite 8 (Rolldown), Tailwind CSS**, and **Capacitor 8**, powered by **Supabase (PostgreSQL 15, Auth, and Row-Level Security)**.

The platform provides complete role-isolated workflows for **Students**, **Faculty / Professors**, and **Administrators**, with strict cryptographic data separation, PostgREST table write lockdown, atomic server-side attendance marking RPCs, an immutable forensic audit trail, a Master Timetable Maker Studio with high-DPI canvas export, and compliance with the **Digital Personal Data Protection (DPDP) Act, 2023**.

---

## 🌟 Key Highlights

- 📱 **Mobile-First Android App**: Packaged via **Capacitor 8** as a native Android APK (`com.collegecompanion.app`) with edge-to-edge support, splash screen, and hardware back-button handling.
- 🔒 **PostgREST Table Write Lockdown**: Direct client `INSERT`, `UPDATE`, and `DELETE` privileges are revoked on `attendance_records` and `sessions`. All state transitions route through transactional PostgreSQL stored procedures (`save_draft_session`, `submit_attendance_session`, `correct_attendance_session`).
- ⚡ **Atomic Server-Side RPCs**: Draft saves, session submissions, and post-submission corrections run inside all-or-nothing transactions with advisory locks preventing duplicate concurrent session creation.
- 📜 **Forensic Audit Trail Immutability**: All attendance modifications after submission mandate a documented justification reason within an administrator-configured correction window. Database triggers physically block all `UPDATE` and `DELETE` operations on `attendance_audit_log`.
- 📅 **Master Timetable Maker Studio**:
  - Interactive grid editor with conflict detection, classroom allocations, and lab batch scheduling.
  - Mobile touch gesture engine with smooth pan, pinch-to-zoom, and auto-centering.
  - High-DPI canvas rendering matching official university formatting with one-tap PNG export and native Android photo sharing.
  - Memory-leak safeguards with canvas deallocation in `try...finally`, bitmap clamping, and blob URL cleanup.
- 🛡️ **DPDP Act 2023 & FERPA Governance**: Grounded institutional privacy notice (`/privacy`) covering Data Fiduciary / Processor roles, Section 9 minor protections (under 18 matriculation agreements), and Section 13 grievance redressal officer contact (`privacy@collegecompanion.edu`) with a statutory 30-day resolution timeline.
- 🚀 **High-Performance Architecture**:
  - Route-based lazy loading (`React.lazy` + `Suspense`) in `App.tsx` reducing initial entry chunk by **82.7%** (from 812 kB down to 47.2 kB).
  - Explicit vendor chunk separation (`vendor-react`, `vendor-router`, `vendor-query`, `vendor-supabase`, `vendor-capacitor`, `vendor-icons`).
  - Native foreground freshness bridge synchronizing Capacitor `appStateChange` with TanStack Query's `focusManager` under a 30s stale window.
- 🧪 **413 Automated Tests**: Comprehensive automated test suite across 16 test files (114 suites) executed natively via Node.js without heavyweight test framework overhead.

---

## 🏗️ Architecture & Technology Stack

```
┌────────────────────────────────────────────────────────┐
│               Android Native Shell (Capacitor 8)       │
│  - App State & Hardware Back-Button Bridge             │
│  - Native Filesystem & Share Plugins                   │
├────────────────────────────────────────────────────────┤
│     React 19 + TypeScript + Vite 8 + Tailwind CSS      │
│   ├── Student Portal         (/student/*)              │
│   ├── Faculty Portal         (/professor/*)            │
│   ├── Administrator Portal   (/admin/*)                │
│   └── Public Privacy Notice  (/privacy)                │
├────────────────────────────────────────────────────────┤
│          TanStack Query v5 + Native Focus Bridge       │
│   ├── Route-Based Lazy Loading (47.2 kB entry chunk)   │
│   ├── Stale-While-Revalidate Foreground Sync           │
│   └── Memory-Tuned Cache GC & Server Pagination        │
├────────────────────────────────────────────────────────┤
│            PostgREST Table Write Lockdown              │
│   ├── Direct Client Writes Blocked (Anon/Auth)         │
│   └── Transactional RPCs (SECURITY DEFINER)            │
│       ├── save_draft_session                           │
│       ├── submit_attendance_session                    │
│       └── correct_attendance_session                   │
├────────────────────────────────────────────────────────┤
│           PostgreSQL Database (Supabase 15)            │
│   ├── Scoped Row Level Security (RLS) Policies         │
│   ├── Anti-Tampering & Audit Immutability Triggers     │
│   ├── Session State & Advisory Locking Engine          │
│   └── Relational Academic & Timetable Schema           │
└────────────────────────────────────────────────────────┘
```

- **Frontend**: React 19.2, TypeScript 6.0, Vite 8.3 (Rolldown engine), Tailwind CSS 3.4, Lucide Icons, React Router v7, TanStack Query v5, react-hot-toast.
- **Native Android**: Capacitor 8.5, Android SDK 36, Java 21 / Gradle 8.
- **Backend & Database**: Supabase PostgreSQL 15, Supabase Auth, Deno Edge Functions (`admin-create-user`).
- **Testing**: Node.js Native Test Runner (`node:test`, `node:assert/strict`) with `--experimental-strip-types`.

---

## 👥 Role Portals & Features

### 1. Student Portal (`/student`)
- **Dashboard**: Real-time greeting, aggregate college attendance percentage, and prominent alert banners for subjects below threshold (default: 75%).
- **Subject Attendance**: Visual progress bars with threshold line markers, classes attended vs. total held, and dynamic status badges (`safe`, `warning`, `danger`).
- **Lecture History**: Per-subject historical audit log detailing lecture dates, start times, session types, and verified presence/absence.
- **Timetable**: Weekly schedule grouped by day with "Today" focus highlighting, lecture times, room numbers, and faculty details.

### 2. Faculty / Professor Portal (`/professor`)
- **Dashboard**: Timetable integration showcasing today's scheduled classes and resume banners for pending unsubmitted drafts.
- **Touch-Optimized Attendance Roster**:
  - Full-screen marking interface with one-thumb toggles (Green = Present, Red = Absent).
  - Bulk actions (**All P**, **All A**) and instant search by student name or roll number.
  - Live sticky header counters (`P: Present`, `A: Absent`, `T: Total`).
  - Active marking queries guarded with `refetchOnWindowFocus: false` to eliminate in-flight input disruption.
- **Atomic Submission & Drafts**: Persists drafts or locks final rosters via atomic PostgreSQL RPCs (`save_draft_session`, `submit_attendance_session`).
- **Controlled Attendance Corrections**: Allows post-submission corrections only within the configured correction window, requiring a mandatory justification reason.
- **Class Reports**: Aggregate attendance analytics per subject and per student.

### 3. Administrator Portal (`/admin`)
- **Executive Dashboard**: System KPI statistics (total enrolled students, active faculty, academic divisions, submitted sessions).
- **Master Timetable Maker Studio**:
  - Full-featured timetable management studio for designing division schedules.
  - Canvas-based visual layout generator matching official college timetable formatting (college header, department title, semester, academic year, weekday/slot grid).
  - High-DPI canvas export with hardware acceleration, responsive zoom gestures, and direct PNG download / native Android photo sharing.
- **Academic Structure**: Comprehensive configuration of Departments, Classes, Batches (lab groups), and Subjects (theory, practical, tutorial).
- **Teaching Assignments**: Map faculty members to subjects, divisions, and specific lab batches.
- **User Management**:
  - Secure single-user onboarding for Students and Professors.
  - Bulk CSV import with validation and atomic compensating rollback.
  - Account status controls (activate / deactivate).
- **Reports & Forensic Audit Log**: Filterable audit trail displaying record modifications, previous status, updated status, modifying user, timestamp, and justification reason.
- **Settings**: Dynamic configuration of college-wide attendance threshold (%) and correction window (hours), with direct links to institutional privacy policies.

### 4. Public Privacy Notice (`/privacy`)
- Grounded compliance document detailing Data Fiduciary and Data Processor designations under the Indian Digital Personal Data Protection (DPDP) Act, 2023.
- Specific Section 9 protections for minor students matriculating under 18 years of age.
- Designated Data Protection Officer / Grievance Redressal contact (`privacy@collegecompanion.edu`) with statutory 30-day resolution procedures (Section 13).

---

## 🔒 Security Model & Database Hardening

1. **Role Enforcement**: Authenticated sessions strictly verify profile roles (`student`, `professor`, `admin`). Attempts to cross portal boundaries trigger automatic redirection to the authorized workspace.
2. **PostgREST Direct Table Write Lockdown**: Table-level `INSERT`, `UPDATE`, and `DELETE` permissions are revoked on `attendance_records` and `sessions` for `anon` and `authenticated` roles. Client mutations MUST invoke hardened stored procedures.
3. **Atomic RPC Workflows**:
   - `save_draft_session`: Validates teaching assignment ownership, checks enrollment, verifies non-future dates, and saves draft records atomically.
   - `submit_attendance_session`: Employs Postgres advisory locks (`pg_advisory_xact_lock`) to prevent race conditions, enforces enrollment integrity, locks session status to `submitted`, and records initial audit entries.
   - `correct_attendance_session`: Enforces policy correction window (`attendance_policy.correction_window_hrs`), mandates a non-empty justification reason, verifies professor ownership or admin privileges, and updates records atomically.
4. **Audit Trail Immutability**: The `attendance_audit_log` table is strictly append-only. The database trigger `prevent_audit_log_modification` blocks all `UPDATE` and `DELETE` statements.
5. **Session Tampering Defense**: Trigger `protect_session_submission` blocks any client attempts to modify `submitted_at` or revert locked sessions back to `draft`.
6. **Compensating Provisioning**: The `admin-create-user` Edge Function automatically rolls back newly created auth users if corresponding profile or academic mapping inserts fail.

---

## 🧪 Testing Suite

The project includes **413 automated tests** across **114 test suites** in 16 test files, executed natively using the Node.js test runner:

```bash
# Run the entire test suite
npm test
```

### Test Coverage Overview

| Test Domain | File | Description |
| :--- | :--- | :--- |
| **Authentication & Normalization** | `tests/auth.test.ts` | Email normalization, mobile character cleanup, password strength, Supabase error parsing, role-based registration rules. |
| **Attendance Calculations** | `tests/attendance.test.ts` | Percentage calculations, zero-session handling, skippable class projections, recovery calculations, what-if simulations. |
| **Security & Role Boundaries** | `tests/security.test.ts` | Student isolation, professor scoping, inactive user access denial, privilege escalation protection, timestamp tampering defense. |
| **Professor Workflows** | `tests/professor.test.ts` | Roster state management, draft resuming, session setup validations, bulk marking actions. |
| **Admin Persistence** | `tests/admin_persistence.test.ts` | Academic structure mutations, assignment mappings, user creation forms, and state transitions. |
| **Attendance Lifecycles** | `tests/attendance_workflow.test.ts` | End-to-end draft save, submit, lock, and correction lifecycle validation. |
| **Session Initialization** | `tests/attendance_session_init.test.ts` | Session setup validation, timetable pre-filling, date constraints. |
| **Timetable Validation** | `tests/timetable_validation.test.ts` | Conflict detection, slot overlap checks, classroom availability invariants. |
| **Timetable Sync & Persistence** | `tests/timetable_sync_persistence.test.ts` | Local persistence, offline fallback, cache synchronization. |
| **Timetable Maker Studio** | `tests/timetable_maker.test.ts` | Interactive grid state, slot allocation, batch separation, clean reset behaviors. |
| **Gesture Engine** | `tests/timetable_gestures.test.ts` | Touch gesture math, pinch-to-zoom clamping, pan bounds, double-tap reset. |
| **High-DPI Canvas & Download** | `tests/timetable_download.test.ts` | High-DPI canvas generation, bitmap deallocation, blob cleanup, native sharing triggers. |
| **Harsh Abrupt Use Hardening** | `tests/security_hardening.test.ts` | PostgREST table write lockdown, RPC invariants, advisory locking concurrency, audit immutability, CSP/HSTS headers, Android backup denial. |
| **Server-Side Pagination** | `tests/pagination.test.ts` | Server-side range indexing (`calcPageRange`), page clamping, pagination summaries. |
| **DPDP Act 2023 Compliance** | `tests/privacy_compliance.test.ts` | Privacy policy page, Section 9 minor protections, Section 13 grievance redressal, FERPA standards. |
| **Foreground Query Freshness** | `tests/query_freshness.test.ts` | Native app resume synchronization (`focusManager`), 30s stale window, active marking protection. |

---

## 🚀 Quick Start & Development

### Prerequisites
- Node.js 22+
- npm 10+
- Android Studio Ladybug+ / SDK 36 (for native Android builds)

### Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables in .env.local
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key-here

# 3. Start local development server
npm run dev

# 4. Run test suite
npm test

# 5. Run Oxlint code analysis
npm run lint

# 6. Build optimized production web bundle
npm run build
```

### Android APK Build & Sync

```bash
# Sync web build to native Android project
npm run android:sync

# Open project in Android Studio
npm run android:open

# Compile debug APK directly via Gradle
npm run android:build
```

The compiled Android debug APK is output to:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📄 License & Institutional Use

This project is licensed for educational and institutional attendance management. Deployed institutions operate as **Data Fiduciaries** with technical governance compliant with the **Digital Personal Data Protection Act, 2023**.
