-- ─────────────────────────────────────────
-- Enable RLS on all tables
-- ─────────────────────────────────────────
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE professors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE students              ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_slots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_policy     ENABLE ROW LEVEL SECURITY;

-- Helper: get the current user's role from profiles
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- Helper: get the current user's professor row id
CREATE OR REPLACE FUNCTION get_my_professor_id()
RETURNS INT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM professors WHERE user_id = auth.uid();
$$;

-- Helper: get the current user's student row id
CREATE OR REPLACE FUNCTION get_my_student_id()
RETURNS INT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM students WHERE user_id = auth.uid();
$$;

-- ─── PROFILES ───────────────────────────
-- Users see only their own profile; admin sees all
CREATE POLICY profiles_self ON profiles FOR SELECT
  USING (id = auth.uid() OR get_my_role() = 'admin');

CREATE POLICY profiles_admin_all ON profiles FOR ALL
  USING (get_my_role() = 'admin');

-- ─── READ-ONLY REFERENCE TABLES ─────────
-- Departments, classes, batches, subjects: all authenticated users can read
CREATE POLICY dept_read ON departments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY dept_admin ON departments FOR ALL USING (get_my_role() = 'admin');

CREATE POLICY classes_read ON classes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY classes_admin ON classes FOR ALL USING (get_my_role() = 'admin');

CREATE POLICY batches_read ON batches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY batches_admin ON batches FOR ALL USING (get_my_role() = 'admin');

CREATE POLICY subjects_read ON subjects FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY subjects_admin ON subjects FOR ALL USING (get_my_role() = 'admin');

-- ─── PROFESSORS & STUDENTS ──────────────
CREATE POLICY professors_read ON professors FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY professors_admin ON professors FOR ALL USING (get_my_role() = 'admin');

-- Students: students see only their own row; professors/admin see all
CREATE POLICY students_self ON students FOR SELECT
  USING (
    user_id = auth.uid()
    OR get_my_role() IN ('professor','admin')
  );
CREATE POLICY students_admin ON students FOR ALL USING (get_my_role() = 'admin');

-- ─── TEACHING ASSIGNMENTS ───────────────
CREATE POLICY ta_read ON teaching_assignments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ta_admin ON teaching_assignments FOR ALL USING (get_my_role() = 'admin');

-- ─── TIMETABLE SLOTS ────────────────────
CREATE POLICY tt_read ON timetable_slots FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tt_admin ON timetable_slots FOR ALL USING (get_my_role() = 'admin');

-- ─── SESSIONS ───────────────────────────
-- Professors can insert/update sessions for their own assignments only
CREATE POLICY sessions_read ON sessions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY sessions_prof_insert ON sessions FOR INSERT
  WITH CHECK (
    get_my_role() = 'professor'
    AND teaching_assignment_id IN (
      SELECT id FROM teaching_assignments WHERE professor_id = get_my_professor_id()
    )
  );

CREATE POLICY sessions_prof_update ON sessions FOR UPDATE
  USING (
    get_my_role() = 'professor'
    AND teaching_assignment_id IN (
      SELECT id FROM teaching_assignments WHERE professor_id = get_my_professor_id()
    )
  );

CREATE POLICY sessions_admin ON sessions FOR ALL USING (get_my_role() = 'admin');

-- ─── ATTENDANCE RECORDS ─────────────────
-- Students can only read their own records
CREATE POLICY ar_student_read ON attendance_records FOR SELECT
  USING (
    student_id = get_my_student_id()
    OR get_my_role() IN ('professor','admin')
  );

-- Professors can insert/update records for sessions they own
CREATE POLICY ar_prof_insert ON attendance_records FOR INSERT
  WITH CHECK (
    get_my_role() = 'professor'
    AND session_id IN (
      SELECT s.id FROM sessions s
      JOIN teaching_assignments ta ON ta.id = s.teaching_assignment_id
      WHERE ta.professor_id = get_my_professor_id()
    )
  );

CREATE POLICY ar_prof_update ON attendance_records FOR UPDATE
  USING (
    get_my_role() = 'professor'
    AND session_id IN (
      SELECT s.id FROM sessions s
      JOIN teaching_assignments ta ON ta.id = s.teaching_assignment_id
      WHERE ta.professor_id = get_my_professor_id()
    )
  );

CREATE POLICY ar_admin ON attendance_records FOR ALL USING (get_my_role() = 'admin');

-- ─── AUDIT LOG ──────────────────────────
-- Insert-only for professors and admins; read for professors/admins
CREATE POLICY audit_read ON attendance_audit_log FOR SELECT
  USING (get_my_role() IN ('professor','admin'));

CREATE POLICY audit_insert ON attendance_audit_log FOR INSERT
  WITH CHECK (get_my_role() IN ('professor','admin'));

-- ─── POLICY ─────────────────────────────
CREATE POLICY policy_read ON attendance_policy FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY policy_admin ON attendance_policy FOR ALL USING (get_my_role() = 'admin');
