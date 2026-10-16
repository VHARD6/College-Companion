-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- PROFILES (extends Supabase auth.users)
-- ─────────────────────────────────────────
CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('student','professor','admin')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create a profile row when a new auth user is created
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─────────────────────────────────────────
-- ACADEMIC STRUCTURE
-- ─────────────────────────────────────────
CREATE TABLE departments (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- A "class" is a division, e.g. "CS-A" in Semester 3, year 2024-25
CREATE TABLE classes (
  id            SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(id),
  name          TEXT NOT NULL,
  semester      INT NOT NULL CHECK (semester BETWEEN 1 AND 8),
  academic_year TEXT NOT NULL  -- e.g. '2024-25'
);

-- Batches are sub-groups within a class, used for practicals
CREATE TABLE batches (
  id       SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id),
  name     TEXT NOT NULL  -- e.g. 'Batch 1'
);

-- Subjects
CREATE TABLE subjects (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  department_id INT NOT NULL REFERENCES departments(id),
  semester      INT NOT NULL CHECK (semester BETWEEN 1 AND 8),
  type          TEXT NOT NULL CHECK (type IN ('theory','practical','tutorial'))
);

-- ─────────────────────────────────────────
-- PEOPLE
-- ─────────────────────────────────────────
CREATE TABLE professors (
  id            SERIAL PRIMARY KEY,
  user_id       UUID NOT NULL UNIQUE REFERENCES profiles(id),
  department_id INT NOT NULL REFERENCES departments(id)
);

CREATE TABLE students (
  id       SERIAL PRIMARY KEY,
  user_id  UUID NOT NULL UNIQUE REFERENCES profiles(id),
  roll_no  TEXT NOT NULL UNIQUE,
  class_id INT NOT NULL REFERENCES classes(id),
  batch_id INT REFERENCES batches(id)  -- nullable; only needed for practicals
);

-- ─────────────────────────────────────────
-- TEACHING ASSIGNMENTS
-- Professor → Subject → Class → Batch(optional)
-- ─────────────────────────────────────────
CREATE TABLE teaching_assignments (
  id           SERIAL PRIMARY KEY,
  professor_id INT NOT NULL REFERENCES professors(id),
  subject_id   INT NOT NULL REFERENCES subjects(id),
  class_id     INT NOT NULL REFERENCES classes(id),
  batch_id     INT REFERENCES batches(id),
  UNIQUE (professor_id, subject_id, class_id, batch_id)
);

-- ─────────────────────────────────────────
-- TIMETABLE
-- ─────────────────────────────────────────
CREATE TABLE timetable_slots (
  id                     SERIAL PRIMARY KEY,
  teaching_assignment_id INT NOT NULL REFERENCES teaching_assignments(id),
  weekday                INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=Monday
  start_time             TIME NOT NULL,
  end_time               TIME NOT NULL,
  room                   TEXT
);

-- ─────────────────────────────────────────
-- SESSIONS & ATTENDANCE
-- ─────────────────────────────────────────
CREATE TABLE sessions (
  id                     SERIAL PRIMARY KEY,
  teaching_assignment_id INT NOT NULL REFERENCES teaching_assignments(id),
  date                   DATE NOT NULL,
  start_time             TIME,
  session_type           TEXT NOT NULL CHECK (session_type IN ('lecture','practical','tutorial')),
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','cancelled')),
  submitted_at           TIMESTAMPTZ,
  submitted_by           UUID REFERENCES profiles(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attendance_records (
  id         SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES sessions(id),
  student_id INT NOT NULL REFERENCES students(id),
  status     TEXT NOT NULL CHECK (status IN ('present','absent')),
  marked_by  UUID REFERENCES profiles(id),
  marked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)  -- prevent duplicate records
);

-- Audit log: insert-only, never update or delete
CREATE TABLE attendance_audit_log (
  id         SERIAL PRIMARY KEY,
  record_id  INT NOT NULL REFERENCES attendance_records(id),
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES profiles(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason     TEXT NOT NULL  -- mandatory for every entry
);

-- ─────────────────────────────────────────
-- ATTENDANCE POLICY
-- Single row for v1 (one college)
-- ─────────────────────────────────────────
CREATE TABLE attendance_policy (
  id                    SERIAL PRIMARY KEY,
  threshold_percent     INT NOT NULL DEFAULT 75,
  correction_window_hrs INT NOT NULL DEFAULT 24
);

-- Seed default policy
INSERT INTO attendance_policy (threshold_percent, correction_window_hrs)
VALUES (75, 24);
