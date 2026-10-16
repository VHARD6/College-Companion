# College Companion 🎓

**College Companion** is an enterprise-grade, mobile-first academic attendance and college management application built with **React 18, TypeScript, Vite, Tailwind CSS**, and **Capacitor 8**, powered by **Supabase (PostgreSQL, Auth, and Row-Level Security)**.

The platform provides complete role-isolated workflows for **Students**, **Faculty/Professors**, and **Administrators**, with strict cryptographic data separation, atomic server-side attendance marking, and an immutable audit trail.

---

## 🌟 Key Highlights

- 📱 **Mobile-First Android App**: Packaged via **Capacitor 8** as a native Android APK (`com.collegecompanion.app`) with smooth navigation and hardware back-button handling.
- 🔒 **Comprehensive Security & Integrity**: Scoped PostgreSQL Row-Level Security (RLS) ensures students access only their own records, and professors access only assigned classes and rosters.
- ⚡ **Atomic Server-Side RPCs**: Attendance submissions, draft saves, and corrections execute inside all-or-nothing PostgreSQL transactions (`submit_attendance_session`, `correct_attendance_records`, `save_draft_session`).
- 📜 **Immutable Audit Trail**: Edits after submission require a mandatory reason within an administrator-configured time window (e.g. 24h). Database triggers prevent updating or deleting audit logs.
- 🛡️ **Hardened Provisioning**: Admin user creation and CSV batch imports route through an isolated Supabase Edge Function (`admin-create-user`) with automatic compensating rollback on auxiliary record failure.
- 🧪 **70 Automated Tests**: Robust test suite covering authentication normalization, attendance formulas, role boundaries, transaction atomicity, and query resilience.

---

## 🏗️ Architecture & Technology Stack

```
┌────────────────────────────────────────────────────────┐
│               Android Native Shell (Capacitor 8)       │
├────────────────────────────────────────────────────────┤
│           React 18 + TypeScript + Vite + Tailwind CSS   │
│   ├── Student Portal   (/student/*)                    │
│   ├── Faculty Portal   (/professor/*)                  │
│   └── Admin Portal     (/admin/*)                      │
├────────────────────────────────────────────────────────┤
│                     Supabase Client                    │
├──────────────────────────┬─────────────────────────────┤
│   Supabase Auth & JWT    │   Supabase Edge Functions   │
│   (Role Metadata)        │   (admin-create-user)       │
├──────────────────────────┴─────────────────────────────┤
│           PostgreSQL Database (Supabase)               │
│   ├── Scoped Row Level Security (RLS) Policies         │
│   ├── Atomic Attendance RPC Functions                  │
│   ├── Immutability & Anti-Tampering Triggers           │
│   └── Relational Academic Structure                    │
└────────────────────────────────────────────────────────┘
```

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, React Router v6, TanStack Query v5, react-hot-toast.
- **Native Android**: Capacitor 8, Android SDK 36, Java 21 / Gradle 8.
- **Backend & Database**: Supabase PostgreSQL 15, Supabase Auth, Deno Edge Functions.
- **Testing**: Node.js Native Test Runner (`node:test`, `node:assert/strict`) with experimental type-stripping.

---

## 👥 Role Portals

### 1. Student Portal (`/student`)
- **Dashboard**: Greeting, overall college attendance percentage, and warning banners for subjects below threshold (default: 75%).
- **Subject Attendance**: Progress bar cards with threshold line markers, classes attended vs. held count, and attendance status classification (`safe`, `warning`, `danger`).
- **Lecture History**: Deep-dive per subject showing date, time, lecture type, and present/absent status.
- **Timetable**: Weekly schedule grouped by weekday with real-time "Today" highlighting, room numbers, and professor names.

### 2. Faculty / Professor Portal (`/professor`)
- **Dashboard**: Timetable integration highlighting today's scheduled classes and resume banners for unsubmitted drafts.
- **Attendance Roster**:
  - Full-screen, touch-optimized attendance marking with one-thumb toggles (Green = Present, Red = Absent).
  - Quick bulk actions (**All P**, **All A**) and live search by student name or roll number.
  - Live counters (`P: X`, `A: Y`, `T: Z`).
- **Atomic Submission & Drafts**: Saves drafts or locks submissions via PostgreSQL RPC transactions.
- **Attendance Corrections**: Allows editing within the active correction window with a mandatory audit reason.
- **Reports**: View aggregate attendance percentages per class and per student with export options.

### 3. Administrator Portal (`/admin`)
- **Dashboard**: High-level KPI statistics (total students, professors, classes, sessions held).
- **Academic Structure**: Manage Departments, Classes, Batches (lab groups), and Subjects (theory, practical, tutorial).
- **Teaching Assignments**: Map professors to subject, class division, and optional batch.
- **Timetable Management**: Create weekly timetable schedules.
- **User Management**:
  - Secure single-user creation for Students and Professors.
  - Bulk CSV import for roster onboarding.
  - One-click account activation / deactivation.
- **Reports & Audit Trail**: Comprehensive audit logs showing previous status, updated status, modifying user, timestamp, and justification reason.
- **Settings**: Dynamic configuration of college-wide attendance threshold (%) and correction window (hours).

---

## 🔒 Security Model & Database Hardening

1. **Role Enforcement**: Authenticated sessions verify profile role (`student`, `professor`, `admin`). Attempts by students to access staff portals or vice versa are blocked and redirected to the appropriate portal.
2. **Strict RLS Scope**:
   - Students can only query their own enrollment and attendance records.
   - Faculty can only access sessions and rosters for classes assigned to them.
   - Role updates on `profiles` are forbidden to non-admin users.
3. **Audit Log Immutability**: The `attendance_audit_log` table allows `INSERT` only. Database trigger `prevent_audit_log_modification` blocks all `UPDATE` and `DELETE` queries.
4. **Session Protection**: Trigger `protect_session_submission` prevents tampering with `submitted_at` or resetting locked sessions back to `draft`.
5. **Compensating Provisioning**: The `admin-create-user` Edge Function cleans up orphaned auth users if any auxiliary profile or role insertion fails.

---

## 🧪 Testing

The test suite runs 70 automated tests across three core testing domains:

```bash
# Run all unit, formula, validation, and security tests
cmd /c npm test
```

- **Authentication & Validation** (`tests/auth.test.ts` — 30 tests):
  Email normalization, mobile keyboard character cleanup, format validation, password strength, Supabase error parsing, role-based registration rules, and portal access routing.
- **Attendance Formulas** (`tests/attendance.test.ts` — 20 tests):
  Percentage calculation, edge cases (zero held, 100%), skippable class projections, consecutive recovery calculations, what-if simulations, and threshold classification.
- **Security & Integrity Hardening** (`tests/security.test.ts` — 20 tests):
  Student isolation, professor assignment scoping, inactive user access denial, privilege escalation protection, session submission verification, idempotency checks, timestamp tampering defense, audit immutability, atomic RPC rollbacks, and error state integrity.

---

## 🚀 Quick Start & Deployment

For complete local setup instructions, Supabase migration deployment, Edge Function configuration, and Android APK compilation, refer to [SETUP.md](file:///c:/Games/ATTENDANCE/SETUP.md).

```bash
# Install dependencies
npm install

# Start Vite development server
npm run dev

# Run Oxlint linter
npx oxlint

# Build production bundle
npm run build

# Build Android APK
npm run android:build
```
