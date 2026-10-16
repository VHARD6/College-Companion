# College Companion — Phase 1 Setup Guide

A fast, mobile-first, subject-wise college attendance application built with **React + TypeScript + Vite + Tailwind CSS** and powered by **Supabase (PostgreSQL, Auth, RLS)**.

---

## 1. Prerequisites

- **Node.js** (v18 or higher recommended)
- A free **Supabase** account at [supabase.com](https://supabase.com)

---

## 2. Supabase Project Setup

1. Log in to [supabase.com](https://supabase.com) and click **New project**.
2. Set a **Project Name** (e.g., `college-companion`) and a secure **Database Password**.
3. Choose a region closest to your college (e.g. `ap-south-1` for India).
4. Once created, go to **Project Settings** → **API**.
5. Copy your:
   - **Project URL** (e.g. `https://xyzcompany.supabase.co`)
   - **anon / public key** (starts with `eyJ...`)

---

## 3. Environment Variables Configuration

Create or update `.env.local` in the project root (`c:\Games\ATTENDANCE\.env.local`):

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

*(Note: `.env.local` is already in `.gitignore` and won't be pushed to version control.)*

---

## 4. Run Database Migrations

In your Supabase dashboard:
1. Navigate to the **SQL Editor** tab on the left sidebar.
2. Click **New Query**.
3. Open and paste the contents of `supabase/migrations/001_initial_schema.sql` and click **Run**.
   - *This creates all tables: `profiles`, `departments`, `classes`, `batches`, `subjects`, `professors`, `students`, `teaching_assignments`, `timetable_slots`, `sessions`, `attendance_records`, `attendance_audit_log`, and `attendance_policy`.*
4. Click **New Query** again.
5. Open and paste the contents of `supabase/migrations/002_rls_policies.sql` and click **Run**.
   - *This activates Row-Level Security (RLS) on all tables and creates strict role-based access rules.*
6. Click **New Query** again.
7. Open and paste the contents of `supabase/migrations/003_secure_registration_and_profiles.sql` and click **Run**.
8. Click **New Query** again.
9. Open and paste the contents of `supabase/migrations/004_fix_handle_new_user_trigger.sql` and click **Run**.
   - *This permanently resolves `relation "profiles" does not exist` by explicitly setting `search_path = public, pg_temp` and reconciles any existing users who were missing profiles.*
10. Click **New Query** again.
11. Open and paste the contents of `supabase/migrations/005_harden_rls_and_corrections.sql` and click **Run**.
   - *This establishes student self-registration verification, audit constraints, and correction window policies.*
12. Click **New Query** again.
13. Open and paste the contents of `supabase/migrations/006_scope_data_access.sql` and click **Run**.
   - *This hardens security across the platform:*
     - Restricts student visibility strictly to their own enrolled attendance and class schedules.
     - Scopes professor access to authorized teaching assignments and assigned rosters only.
     - Enforces audit log immutability via `prevent_audit_log_modification` trigger (revoking `UPDATE` and `DELETE`).
     - Adds `protect_session_submission` trigger preventing reopened sessions or timestamp manipulation.
     - Deploys atomic SECURITY DEFINER RPC functions: `submit_attendance_session`, `correct_attendance_records`, and `save_draft_session`.
14. (Optional) Run `supabase/seed.sql` to insert sample Computer Science department, class divisions, batches, and subjects.

---

## 5. Deploy the Admin User Provisioning Edge Function

Admin user creation and CSV batch imports run via the server-side Edge Function `admin-create-user`.

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) or use the Supabase Dashboard:
   - In Supabase Dashboard, navigate to **Edge Functions** → **Deploy a new function**.
   - Or deploy via CLI:
     ```bash
     supabase functions deploy admin-create-user --project-ref your-project-ref
     ```
2. In Supabase Dashboard → **Edge Functions** → **Secrets**, ensure the following secret is active:
   - `SUPABASE_SERVICE_ROLE_KEY`: Your project's service role secret (found in **Project Settings** → **API**).
   *(Note: The `admin-create-user` function uses this secret to safely invoke `auth.admin.createUser` and roll back auth accounts if profile/student/professor record insertion fails).*

---

## 6. Create Your First Admin User

Because Supabase Auth handles authentication, create your primary Admin account:

1. In Supabase Dashboard, go to **Authentication** → **Users** → **Add User** → **Create user**.
2. Enter an email (e.g. `admin@gmail.com`) and a strong password. Click **Create user**.
3. Go to the **Table Editor** → open the `profiles` table.
4. Find the row for your newly created user.
5. Change the `role` column from `'student'` to `'admin'` and save.

Now you can log into the application with full administrator privileges!

---

## 6. Run the App

From the project root:

```bash
# If running in Windows PowerShell, use:
cmd /c npm run dev

# Or directly:
npm run dev
```

Open your browser at `http://localhost:5173`.

---

## 7. First-Time Setup Workflow (Admin)

Log in with your Admin credentials to configure your college structure:

1. **Academic Structure** (`/admin/structure`):
   - Add your **Departments** (e.g. *Computer Science*).
   - Add your **Classes** (e.g. *CS-A*, *CS-B* with Semester and Academic Year).
   - Add **Batches** for practical lab divisions (e.g. *Batch 1*, *Batch 2*).
   - Add **Subjects** (Theory, Practical, Tutorial with subject codes).

2. **User Management** (`/admin/users`):
   - Click **Add User** to create individual Professors, Students, or Admins.
   - Or click **CSV Import** to bulk create students with roll numbers and class assignments.
     ```csv
     name,email,password,roll_no,class_name,batch_name
     Aakash Sharma,aakash@gmail.com,Pass1234,CS001,CS-A,Batch 1
     Bhavna Patel,bhavna@gmail.com,Pass1234,CS002,CS-A,Batch 1
     Chirag Verma,chirag@gmail.com,Pass1234,CS003,CS-A,Batch 2
     ```

3. **Teaching Assignments** (`/admin/assignments`):
   - Map each Professor to their assigned Subject, Class division, and optional Practical Batch.

4. **Timetable Schedule** (`/admin/timetable`):
   - Schedule weekly lecture and lab slots with start/end times and classroom numbers.

5. **Settings & Policy** (`/admin/settings`):
   - Configure the college attendance threshold (default: 75%).
   - Configure the session correction window (default: 24 hours).

---

## 8. Role Features & Workflows

### 👩‍🏫 Professor Workflow
1. Log in → **Professor Dashboard** lists Today's Classes from the timetable and all assigned subjects.
2. Click **Mark Attendance** or tap a class slot:
   - Roster opens with all enrolled students defaulted to **Present**.
   - Toggle absences with one thumb tap (Green = P, Red = A).
   - Live counters display `Present: X / Absent: Y / Total: Z`.
   - Search by name or roll number.
   - Click **Save Draft** to save progress without locking.
   - Click **Submit Attendance**: confirmation dialog reviews absentee count before locking session.
3. **Session Corrections**:
   - If within the correction window (e.g., 24h), professor can adjust records by entering a **mandatory reason**.
   - Every edit is permanently written to the `attendance_audit_log`.

### 🎓 Student Workflow
1. Log in → **Student Dashboard** displays:
   - Greeting & overall college attendance percentage.
   - Per-subject attendance cards with progress bar and threshold indicator.
   - Visual shortage warnings (under 75%).
2. Tap any subject to view **Lecture History** (date, time, lecture/practical, Present/Absent status).
3. Tap **Timetable** in bottom navigation to view weekly schedule.

### 🛡️ Admin Workflow
- Overview metric counters (Students, Professors, Classes, Sessions).
- Complete User Management with CSV bulk upload and account deactivation.
- Complete Academic Structure management (Departments, Classes, Batches, Subjects).
- Teaching Assignments and Timetable scheduling.
- **Reports & Audit Log**: review submitted sessions and inspect immutable audit log records.

---

## 9. Automated Testing

The project includes 70 automated tests covering authentication normalization, portal boundaries, attendance recovery formulas, session submission atomicity, and audit immutability.

```bash
# Run the complete test suite
cmd /c npm test
```

Tests run with Node.js 22+ native test runner (`node --experimental-strip-types`):
- `tests/auth.test.ts`: 30 tests (email sanitation, validation, auth diagnostics, portal route protection).
- `tests/attendance.test.ts`: 20 tests (percentages, skippable formulas, recovery needed, status badges).
- `tests/security.test.ts`: 20 tests (RLS isolation, audit protection, rollback simulation, idempotency).

---

## 10. Building for Production

```bash
cmd /c npm run build
```

The output bundle is generated in `dist/` ready to deploy to Vercel, Netlify, or any static hosting service.

---

## 11. Building and Installing the Android APK

The project is packaged for Android using **Capacitor 8**.

### Prerequisites
1. **JDK 21**: Capacitor 8 compiles targeting Java 21. Ensure Amazon Corretto 21 (or equivalent JDK 21) is installed and configured in `android/gradle.properties`:
   ```properties
   org.gradle.java.home=C:\\Games\\jdk21.0.12_12
   ```
2. **Android SDK**: Android SDK Platform 36 and Build-Tools 35.0.0 / 36.0.0 installed. Ensure `android/local.properties` specifies your SDK path:
   ```properties
   sdk.dir=C\:\\Users\\omras\\AppData\\Local\\Android\\Sdk
   ```
3. **Android Studio** (optional, for visual debugging and profiling).

### Build Commands

```bash
# 1. Compile web assets:
cmd /c npm run build

# 2. Sync web changes into Android native project:
npx cap sync android

# 3. Build debug APK directly from command line:
cmd /c "cd /d c:\Games\ATTENDANCE\android && gradlew.bat assembleDebug"
```

### Generated APK Location
Upon a successful build, the installable debug APK is generated at:
```
android\app\build\outputs\apk\debug\app-debug.apk
```

### Installing on an Android Device

#### Option A: Wireless ADB (Recommended)
1. Ensure your Android device and PC are connected to the same Wi-Fi network.
2. Enable **Developer Options** → **Wireless Debugging** on the device.
3. Pair/connect via ADB:
   ```bash
   adb connect <device-ip>:<port>
   # or verify existing wireless connection:
   adb devices
   ```
4. Install the fresh APK:
   ```bash
   adb install -r android\app\build\outputs\apk\debug\app-debug.apk
   ```
5. Launch the application:
   ```bash
   adb shell am start -n com.collegecompanion.app/.MainActivity
   ```

#### Option B: Via USB Debugging
1. Connect device via USB cable with USB Debugging enabled.
2. Run:
   ```bash
   adb install -r android\app\build\outputs\apk\debug\app-debug.apk
   ```

#### Option C: Direct APK File Transfer
1. Copy `app-debug.apk` to your phone via USB cable, Google Drive, or cloud storage.
2. Locate the APK file in your phone's file manager and tap it to install.
3. If prompted, grant permission to **"Install unknown apps"** in your phone's Settings.

### Troubleshooting
- **`invalid source release: 21`**: Ensure Gradle uses JDK 21. Verify `org.gradle.java.home` in `android/gradle.properties`.
- **SDK location not found**: Verify `android/local.properties` contains `sdk.dir` pointing to your Android SDK folder.
- **Hardware Back Button**: The app is configured with `@capacitor/app` to exit gracefully from root views (`/login`, `/student`, `/professor`, `/admin`) and navigate back across child pages.

