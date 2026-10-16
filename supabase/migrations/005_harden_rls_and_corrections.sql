-- ─────────────────────────────────────────────────────────────
-- MIGRATION 005: Security Hardening & Server-Side Correction Enforcement
-- 1. Inactive account revocation across all helper functions
-- 2. Database-level enforcement of the session correction window
-- 3. Scoped audit log insertion rules for professors
-- 4. Academic structure uniqueness safeguards
-- 5. Default policy guarantee
-- ─────────────────────────────────────────────────────────────

-- 1. Helper functions: Enforce is_active = true and secure search_path
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_my_professor_id()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT pr.id
  FROM public.professors pr
  JOIN public.profiles p ON p.id = pr.user_id
  WHERE pr.user_id = auth.uid() AND p.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_my_student_id()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id
  FROM public.students s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.user_id = auth.uid() AND p.is_active = true;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_professor_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_student_id() TO authenticated, anon;

-- 2. Enforce Correction Window at Database Level for Attendance Records
DROP POLICY IF EXISTS ar_prof_update ON public.attendance_records;
CREATE POLICY ar_prof_update ON public.attendance_records
  FOR UPDATE
  USING (
    get_my_role() = 'professor'
    AND session_id IN (
      SELECT s.id FROM public.sessions s
      JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
      WHERE ta.professor_id = get_my_professor_id()
        AND (
          s.status = 'draft'
          OR (
            s.status = 'submitted'
            AND s.submitted_at IS NOT NULL
            AND (now() - s.submitted_at) <= (
              SELECT (COALESCE(correction_window_hrs, 24) || ' hours')::interval
              FROM public.attendance_policy
              LIMIT 1
            )
          )
        )
    )
  );

-- 3. Enforce Correction Window at Database Level for Sessions
DROP POLICY IF EXISTS sessions_prof_update ON public.sessions;
CREATE POLICY sessions_prof_update ON public.sessions
  FOR UPDATE
  USING (
    get_my_role() = 'professor'
    AND teaching_assignment_id IN (
      SELECT id FROM public.teaching_assignments WHERE professor_id = get_my_professor_id()
    )
    AND (
      status = 'draft'
      OR (
        status = 'submitted'
        AND submitted_at IS NOT NULL
        AND (now() - submitted_at) <= (
          SELECT (COALESCE(correction_window_hrs, 24) || ' hours')::interval
          FROM public.attendance_policy
          LIMIT 1
        )
      )
    )
  );

-- 4. Scope Professor Audit Log Inserts strictly to their own sessions
DROP POLICY IF EXISTS audit_insert ON public.attendance_audit_log;
CREATE POLICY audit_insert ON public.attendance_audit_log
  FOR INSERT
  WITH CHECK (
    get_my_role() = 'admin'
    OR (
      get_my_role() = 'professor'
      AND length(trim(reason)) > 0
      AND record_id IN (
        SELECT ar.id FROM public.attendance_records ar
        JOIN public.sessions s ON s.id = ar.session_id
        JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
        WHERE ta.professor_id = get_my_professor_id()
      )
    )
  );

-- 5. Scope Professor Audit Log Reads to their own sessions or Admins
DROP POLICY IF EXISTS audit_read ON public.attendance_audit_log;
CREATE POLICY audit_read ON public.attendance_audit_log
  FOR SELECT
  USING (
    get_my_role() = 'admin'
    OR (
      get_my_role() = 'professor'
      AND record_id IN (
        SELECT ar.id FROM public.attendance_records ar
        JOIN public.sessions s ON s.id = ar.session_id
        JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
        WHERE ta.professor_id = get_my_professor_id()
      )
    )
  );

-- 6. Guarantee that default attendance policy row exists
INSERT INTO public.attendance_policy (threshold_percent, correction_window_hrs)
SELECT 75, 24
WHERE NOT EXISTS (SELECT 1 FROM public.attendance_policy);

-- 7. Add duplicate prevention constraints on academic structure if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_classes_dept_name_sem_year'
  ) THEN
    ALTER TABLE public.classes 
      ADD CONSTRAINT uq_classes_dept_name_sem_year 
      UNIQUE (department_id, name, semester, academic_year);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_batches_class_name'
  ) THEN
    ALTER TABLE public.batches 
      ADD CONSTRAINT uq_batches_class_name 
      UNIQUE (class_id, name);
  END IF;
END $$;
