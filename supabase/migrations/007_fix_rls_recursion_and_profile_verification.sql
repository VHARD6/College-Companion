-- ─────────────────────────────────────────────────────────────
-- MIGRATION 007: Eliminate RLS Policy Recursion & Secure Profile Verification
-- 
-- ROOT CAUSE RESOLUTION:
-- Migration 006 introduced cross-table subqueries inside RLS policies:
--   1. `profiles_read_scoped` on `profiles` subqueried `students`.
--   2. `students_prof_read` on `students` subqueried `teaching_assignments`.
--   3. `ta_student_read` on `teaching_assignments` subqueried `students`.
-- This formed an immediate circular dependency graph during query planning:
--   profiles -> students -> teaching_assignments -> students
-- When an authenticated user attempted to query their own profile at login:
--   supabase.from('profiles').select('*').eq('id', authedUser.id)
-- PostgreSQL detected the cycle and aborted with:
--   ERROR 42P17: infinite recursion detected in policy for relation "students"
--
-- FIX STRATEGY:
-- 1. Redefine all helper functions using `LANGUAGE plpgsql SECURITY DEFINER`
--    with explicit `search_path = public, pg_temp` so they execute with
--    elevated bypass privileges and cannot be inlined by the query planner.
-- 2. Decouple cross-table subqueries:
--    - Helper functions `get_my_student_class_id()` and `get_my_student_batch_id()`
--      extract class and batch IDs without triggering RLS on `students`.
--    - Helper function `can_access_student_roster(class_id, batch_id)` verifies
--      professor assignment without a direct subquery on `teaching_assignments`.
--    - Helper function `can_read_academic_profile(target_user_id)` evaluates
--      academic relationships in PL/pgSQL with `SECURITY DEFINER` outside RLS.
-- 3. Replace `profiles_read_scoped` with:
--    - `profiles_self_read`: Simple, zero-subquery `id = auth.uid()` policy.
--    - `profiles_academic_read`: Scoped read using `can_read_academic_profile(id)`.
--    - `profiles_admin_manage`: Full access for administrators.
-- 4. Reconcile any orphaned `auth.users` that are missing a `public.profiles` row.
-- ─────────────────────────────────────────────────────────────

-- ─── 1. REPAIR & REINFORCE SECURITY DEFINER HELPER FUNCTIONS ─────────

-- Role retrieval (STABLE, PL/pgSQL, never inlined)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true;

  RETURN v_role;
END;
$$;

-- Professor ID retrieval
CREATE OR REPLACE FUNCTION public.get_my_professor_id()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pr.id INTO v_id
  FROM public.professors pr
  JOIN public.profiles p ON p.id = pr.user_id
  WHERE pr.user_id = auth.uid() AND p.is_active = true;

  RETURN v_id;
END;
$$;

-- Student ID retrieval
CREATE OR REPLACE FUNCTION public.get_my_student_id()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.id INTO v_id
  FROM public.students s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.user_id = auth.uid() AND p.is_active = true;

  RETURN v_id;
END;
$$;

-- Student Class ID retrieval (Decouples teaching_assignments from querying students table)
CREATE OR REPLACE FUNCTION public.get_my_student_class_id()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class_id INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.class_id INTO v_class_id
  FROM public.students s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.user_id = auth.uid() AND p.is_active = true;

  RETURN v_class_id;
END;
$$;

-- Student Batch ID retrieval (Decouples teaching_assignments from querying students table)
CREATE OR REPLACE FUNCTION public.get_my_student_batch_id()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.batch_id INTO v_batch_id
  FROM public.students s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.user_id = auth.uid() AND p.is_active = true;

  RETURN v_batch_id;
END;
$$;

-- Check if currently logged in professor teaches a student's class/batch
-- (Decouples students table policy from directly subquerying teaching_assignments)
CREATE OR REPLACE FUNCTION public.can_access_student_roster(p_class_id INT, p_batch_id INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prof_id INT;
BEGIN
  v_prof_id := public.get_my_professor_id();
  IF v_prof_id IS NULL OR p_class_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.teaching_assignments ta
    WHERE ta.professor_id = v_prof_id
      AND ta.class_id = p_class_id
      AND (ta.batch_id IS NULL OR p_batch_id IS NULL OR ta.batch_id = p_batch_id)
  );
END;
$$;

-- Evaluates academic relationships for profile name reading
-- (Decouples profiles table policy from circular table subqueries)
CREATE OR REPLACE FUNCTION public.can_read_academic_profile(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_my_role TEXT;
  v_prof_id INT;
  v_class_id INT;
  v_batch_id INT;
BEGIN
  IF target_user_id IS NULL OR auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Reading own profile is permitted
  IF target_user_id = auth.uid() THEN
    RETURN TRUE;
  END IF;

  v_my_role := public.get_my_role();

  -- Admin can read all profiles
  IF v_my_role = 'admin' THEN
    RETURN TRUE;
  END IF;

  -- Professor can read fellow professors & enrolled students in their classes
  IF v_my_role = 'professor' THEN
    IF EXISTS (SELECT 1 FROM public.professors WHERE user_id = target_user_id) THEN
      RETURN TRUE;
    END IF;

    v_prof_id := public.get_my_professor_id();
    IF v_prof_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.teaching_assignments ta ON ta.class_id = s.class_id
      WHERE s.user_id = target_user_id
        AND ta.professor_id = v_prof_id
        AND (ta.batch_id IS NULL OR ta.batch_id = s.batch_id)
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- Student can read professors teaching their class/batch
  IF v_my_role = 'student' THEN
    v_class_id := public.get_my_student_class_id();
    v_batch_id := public.get_my_student_batch_id();

    IF v_class_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.professors pr
      JOIN public.teaching_assignments ta ON ta.professor_id = pr.id
      WHERE pr.user_id = target_user_id
        AND ta.class_id = v_class_id
        AND (ta.batch_id IS NULL OR ta.batch_id = v_batch_id)
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_professor_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_student_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_student_class_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_student_batch_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_access_student_roster(INT, INT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_read_academic_profile(UUID) TO authenticated, anon;


-- ─── 2. REBUILD POLICIES ON PUBLIC.PROFILES ──────────────────────────

DROP POLICY IF EXISTS profiles_self ON public.profiles;
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_manage ON public.profiles;
DROP POLICY IF EXISTS profiles_read_scoped ON public.profiles;
DROP POLICY IF EXISTS profiles_academic_read ON public.profiles;

-- Instant, direct, non-recursive self-read (essential for auth login)
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

-- Scoped academic visibility for rosters and timetable teacher names
CREATE POLICY profiles_academic_read ON public.profiles
  FOR SELECT
  USING (public.can_read_academic_profile(id));

-- Admin full management
CREATE POLICY profiles_admin_manage ON public.profiles
  FOR ALL
  USING (public.get_my_role() = 'admin');


-- ─── 3. REBUILD POLICIES ON PUBLIC.TEACHING_ASSIGNMENTS ──────────────

DROP POLICY IF EXISTS ta_read ON public.teaching_assignments;
DROP POLICY IF EXISTS ta_admin ON public.teaching_assignments;
DROP POLICY IF EXISTS ta_prof_read ON public.teaching_assignments;
DROP POLICY IF EXISTS ta_student_read ON public.teaching_assignments;

-- Admin full access
CREATE POLICY ta_admin ON public.teaching_assignments
  FOR ALL
  USING (public.get_my_role() = 'admin');

-- Professor reads assignments they teach
CREATE POLICY ta_prof_read ON public.teaching_assignments
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND professor_id = public.get_my_professor_id()
  );

-- Student reads assignments for their class/batch (Zero subqueries on students table)
CREATE POLICY ta_student_read ON public.teaching_assignments
  FOR SELECT
  USING (
    public.get_my_role() = 'student'
    AND class_id = public.get_my_student_class_id()
    AND (
      batch_id IS NULL
      OR batch_id = public.get_my_student_batch_id()
    )
  );


-- ─── 4. REBUILD POLICIES ON PUBLIC.STUDENTS ──────────────────────────

DROP POLICY IF EXISTS students_self ON public.students;
DROP POLICY IF EXISTS students_self_read ON public.students;
DROP POLICY IF EXISTS students_prof_read ON public.students;
DROP POLICY IF EXISTS students_admin ON public.students;

-- Admin full access
CREATE POLICY students_admin ON public.students
  FOR ALL
  USING (public.get_my_role() = 'admin');

-- Student reads their own record
CREATE POLICY students_self_read ON public.students
  FOR SELECT
  USING (user_id = auth.uid());

-- Professor reads roster via SECURITY DEFINER function (Zero raw subqueries on teaching_assignments)
CREATE POLICY students_prof_read ON public.students
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND public.can_access_student_roster(class_id, batch_id)
  );


-- ─── 5. REBUILD POLICIES ON PUBLIC.TIMETABLE_SLOTS ───────────────────

DROP POLICY IF EXISTS tt_read ON public.timetable_slots;
DROP POLICY IF EXISTS tt_admin ON public.timetable_slots;
DROP POLICY IF EXISTS tt_prof_read ON public.timetable_slots;
DROP POLICY IF EXISTS tt_student_read ON public.timetable_slots;

CREATE POLICY tt_admin ON public.timetable_slots
  FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY tt_prof_read ON public.timetable_slots
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND teaching_assignment_id IN (
      SELECT ta.id FROM public.teaching_assignments ta
      WHERE ta.professor_id = public.get_my_professor_id()
    )
  );

CREATE POLICY tt_student_read ON public.timetable_slots
  FOR SELECT
  USING (
    public.get_my_role() = 'student'
    AND teaching_assignment_id IN (
      SELECT ta.id FROM public.teaching_assignments ta
      WHERE ta.class_id = public.get_my_student_class_id()
        AND (ta.batch_id IS NULL OR ta.batch_id = public.get_my_student_batch_id())
    )
  );


-- ─── 6. REBUILD POLICIES ON PUBLIC.SESSIONS ──────────────────────────

DROP POLICY IF EXISTS sessions_read ON public.sessions;
DROP POLICY IF EXISTS sessions_admin ON public.sessions;
DROP POLICY IF EXISTS sessions_prof_read ON public.sessions;
DROP POLICY IF EXISTS sessions_student_read ON public.sessions;

CREATE POLICY sessions_admin ON public.sessions
  FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY sessions_prof_read ON public.sessions
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND teaching_assignment_id IN (
      SELECT ta.id FROM public.teaching_assignments ta
      WHERE ta.professor_id = public.get_my_professor_id()
    )
  );

CREATE POLICY sessions_student_read ON public.sessions
  FOR SELECT
  USING (
    public.get_my_role() = 'student'
    AND status = 'submitted'
    AND teaching_assignment_id IN (
      SELECT ta.id FROM public.teaching_assignments ta
      WHERE ta.class_id = public.get_my_student_class_id()
        AND (ta.batch_id IS NULL OR ta.batch_id = public.get_my_student_batch_id())
    )
  );


-- ─── 7. REBUILD POLICIES ON PUBLIC.ATTENDANCE_RECORDS ────────────────

DROP POLICY IF EXISTS ar_student_read ON public.attendance_records;
DROP POLICY IF EXISTS ar_prof_read ON public.attendance_records;
DROP POLICY IF EXISTS ar_admin ON public.attendance_records;

CREATE POLICY ar_admin ON public.attendance_records
  FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY ar_student_read ON public.attendance_records
  FOR SELECT
  USING (
    public.get_my_role() = 'student'
    AND student_id = public.get_my_student_id()
  );

CREATE POLICY ar_prof_read ON public.attendance_records
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND session_id IN (
      SELECT s.id FROM public.sessions s
      JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
      WHERE ta.professor_id = public.get_my_professor_id()
    )
  );


-- ─── 8. REBUILD POLICIES ON PUBLIC.ATTENDANCE_AUDIT_LOG ──────────────

DROP POLICY IF EXISTS audit_read ON public.attendance_audit_log;
DROP POLICY IF EXISTS audit_insert ON public.attendance_audit_log;
DROP POLICY IF EXISTS audit_admin ON public.attendance_audit_log;
DROP POLICY IF EXISTS audit_prof_read ON public.attendance_audit_log;
DROP POLICY IF EXISTS audit_prof_insert ON public.attendance_audit_log;

CREATE POLICY audit_admin ON public.attendance_audit_log
  FOR ALL
  USING (public.get_my_role() = 'admin');

CREATE POLICY audit_prof_read ON public.attendance_audit_log
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND record_id IN (
      SELECT ar.id FROM public.attendance_records ar
      JOIN public.sessions s ON s.id = ar.session_id
      JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
      WHERE ta.professor_id = public.get_my_professor_id()
    )
  );

CREATE POLICY audit_prof_insert ON public.attendance_audit_log
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'professor'
    AND length(trim(reason)) > 0
    AND record_id IN (
      SELECT ar.id FROM public.attendance_records ar
      JOIN public.sessions s ON s.id = ar.session_id
      JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
      WHERE ta.professor_id = public.get_my_professor_id()
    )
  );


-- ─── 9. IDEMPOTENT PROFILE RECONCILIATION ────────────────────────────

-- Safely provision profile rows for any auth users that do not have one yet
INSERT INTO public.profiles (id, name, role, is_active, created_at)
SELECT 
  u.id,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1), 'User'),
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'role'), ''), 'student'),
  true,
  COALESCE(u.created_at, now())
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
