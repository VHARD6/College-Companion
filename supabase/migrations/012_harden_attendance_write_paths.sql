-- ─────────────────────────────────────────────────────────────
-- MIGRATION 012: Harden Attendance Write Paths, Session Ownership & Assignment Uniqueness
--
-- 1. ELIMINATE UNAUTHORIZED DIRECT WRITE PATHS:
--    - Revoke direct INSERT, UPDATE, DELETE privileges on `attendance_records`,
--      `sessions`, and `attendance_audit_log` from authenticated, anon, and public.
--    - Drop obsolete permissive write RLS policies (ar_prof_insert, ar_prof_update,
--      ar_admin, sessions_prof_insert, sessions_prof_update, sessions_admin, audit_insert).
--    - Ensure all attendance writes MUST execute through authorized SECURITY DEFINER RPCs:
--      * `save_draft_session`
--      * `submit_attendance_session`
--      * `correct_attendance_records`
--    - Maintain legitimate SELECT privileges and RLS read policies for students,
--      professors, and administrators across all three tables.
--
-- 2. HARDEN SESSION OWNERSHIP & CONCURRENCY IN submit_attendance_session:
--    - When p_session_id is provided, verify using row-level locking (FOR UPDATE)
--      that the session exists and belongs to the exact p_teaching_assignment_id.
--    - Reject sessions belonging to other teaching assignments, missing sessions,
--      and already-submitted sessions.
--    - Align student class and batch enrollment boundaries with Migration 011
--      (strict batch matching when ta.batch_id IS NOT NULL).
--    - Enforce atomic transaction guarantees and mandatory audit trail generation.
--
-- 3. ENFORCE WHOLE-CLASS TEACHING ASSIGNMENT UNIQUENESS:
--    - In PostgreSQL, standard UNIQUE constraints treat NULL != NULL, allowing
--      duplicate whole-class assignments (where batch_id IS NULL).
--    - Check for existing duplicate records first without destructive alteration.
--    - Create a partial unique index on (professor_id, subject_id, class_id)
--      WHERE batch_id IS NULL.
-- ─────────────────────────────────────────────────────────────

-- ─── 1. TABLE PRIVILEGE REVOCATIONS (ELIMINATE DIRECT WRITE PATHS) ─────

-- Revoke direct table mutations from all client-accessible roles
REVOKE INSERT, UPDATE, DELETE ON public.attendance_records FROM authenticated, anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.sessions FROM authenticated, anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_audit_log FROM authenticated, anon, public;

-- Explicitly ensure SELECT privileges remain available for authorized reads
GRANT SELECT ON public.attendance_records TO authenticated;
GRANT SELECT ON public.sessions TO authenticated;
GRANT SELECT ON public.attendance_audit_log TO authenticated;

-- ─── 2. REMOVE OBSOLETE PERMISSIVE WRITE RLS POLICIES ─────────────────

-- Attendance records: drop obsolete write policies
DROP POLICY IF EXISTS ar_prof_insert ON public.attendance_records;
DROP POLICY IF EXISTS ar_prof_update ON public.attendance_records;
DROP POLICY IF EXISTS ar_admin ON public.attendance_records;

-- Sessions: drop obsolete write policies
DROP POLICY IF EXISTS sessions_prof_insert ON public.sessions;
DROP POLICY IF EXISTS sessions_prof_update ON public.sessions;
DROP POLICY IF EXISTS sessions_admin ON public.sessions;

-- Attendance audit log: drop direct client insert policy
DROP POLICY IF EXISTS audit_insert ON public.attendance_audit_log;

-- ─── 3. PRESERVE ADMIN SELECT CAPABILITIES ACROSS PROTECTED TABLES ────

-- Admin SELECT policy on attendance_records
DROP POLICY IF EXISTS ar_admin_read ON public.attendance_records;
CREATE POLICY ar_admin_read ON public.attendance_records
  FOR SELECT
  USING (public.get_my_role() = 'admin');

-- Admin SELECT policy on sessions
DROP POLICY IF EXISTS sessions_admin_read ON public.sessions;
CREATE POLICY sessions_admin_read ON public.sessions
  FOR SELECT
  USING (public.get_my_role() = 'admin');

-- Admin SELECT policy on attendance_audit_log
DROP POLICY IF EXISTS audit_admin_read ON public.attendance_audit_log;
CREATE POLICY audit_admin_read ON public.attendance_audit_log
  FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── 4. HARDEN submit_attendance_session RPC ─────────────────────────

CREATE OR REPLACE FUNCTION public.submit_attendance_session(
  p_session_id INT,
  p_teaching_assignment_id INT,
  p_date DATE,
  p_session_type TEXT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_prof_id INT;
  v_ta_class_id INT;
  v_ta_batch_id INT;
  v_session_id INT := p_session_id;
  v_existing_status TEXT;
  v_rec JSONB;
  v_student_id INT;
  v_status TEXT;
  v_record_id INT;
  v_inserted_count INT := 0;
BEGIN
  -- 1. Verify caller role (must be active professor or admin)
  v_role := public.get_my_role();
  IF v_role NOT IN ('professor', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only active professors or admins can submit attendance';
  END IF;

  -- 2. Verify assignment ownership if caller is professor
  IF v_role = 'professor' THEN
    v_prof_id := public.get_my_professor_id();
    IF NOT EXISTS (
      SELECT 1 FROM public.teaching_assignments
      WHERE id = p_teaching_assignment_id AND professor_id = v_prof_id
    ) THEN
      RAISE EXCEPTION 'Forbidden: You are not authorized for teaching assignment %', p_teaching_assignment_id;
    END IF;
  END IF;

  -- 3. Retrieve and validate assignment class and batch metadata
  SELECT class_id, batch_id INTO v_ta_class_id, v_ta_batch_id
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id;

  IF v_ta_class_id IS NULL THEN
    RAISE EXCEPTION 'Teaching assignment % not found', p_teaching_assignment_id;
  END IF;

  -- 4. Date validation: cannot submit attendance for a future date
  IF p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot mark attendance for a future date (%)', p_date;
  END IF;

  -- Validate session type
  IF p_session_type NOT IN ('lecture', 'practical', 'tutorial') THEN
    RAISE EXCEPTION 'Invalid session type: %', p_session_type;
  END IF;

  -- Validate that student records payload is non-empty
  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'Cannot submit attendance session with empty student records.';
  END IF;

  -- 5. Safe session ownership and status verification with concurrency locking (FOR UPDATE)
  IF v_session_id IS NOT NULL THEN
    -- Verify the session exists and belongs to this exact teaching assignment
    SELECT status INTO v_existing_status
    FROM public.sessions
    WHERE id = v_session_id AND teaching_assignment_id = p_teaching_assignment_id
    FOR UPDATE;

    IF v_existing_status IS NULL THEN
      -- Differentiate between a non-existent session and a cross-assignment mismatch
      IF EXISTS (SELECT 1 FROM public.sessions WHERE id = v_session_id) THEN
        RAISE EXCEPTION 'Session % does not belong to teaching assignment %', v_session_id, p_teaching_assignment_id;
      ELSE
        RAISE EXCEPTION 'Session % not found for teaching assignment %', v_session_id, p_teaching_assignment_id;
      END IF;
    END IF;

    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Session % has already been submitted. Use correction workflow for modifications.', v_session_id;
    END IF;
  ELSE
    -- Check for existing session by assignment and date with row locking
    SELECT id, status INTO v_session_id, v_existing_status
    FROM public.sessions
    WHERE teaching_assignment_id = p_teaching_assignment_id AND date = p_date
    FOR UPDATE
    LIMIT 1;

    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Attendance for this subject on % has already been submitted (session %).', p_date, v_session_id;
    END IF;
  END IF;

  -- 6. Upsert session as submitted with authoritative server timestamp now()
  IF v_session_id IS NULL THEN
    INSERT INTO public.sessions (
      teaching_assignment_id, date, session_type, status, submitted_at, submitted_by
    ) VALUES (
      p_teaching_assignment_id, p_date, p_session_type, 'submitted', now(), auth.uid()
    ) RETURNING id INTO v_session_id;
  ELSE
    UPDATE public.sessions
    SET status = 'submitted',
        submitted_at = now(),
        submitted_by = auth.uid(),
        session_type = p_session_type,
        date = p_date
    WHERE id = v_session_id;
  END IF;

  -- 7. Validate each student's enrollment and upsert attendance records atomically
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
  LOOP
    v_student_id := (v_rec->>'student_id')::INT;
    v_status := v_rec->>'status';

    IF v_student_id IS NULL THEN
      RAISE EXCEPTION 'Missing or invalid student_id in attendance records';
    END IF;

    IF v_status NOT IN ('present', 'absent') THEN
      RAISE EXCEPTION 'Invalid attendance status "%" for student %', v_status, v_student_id;
    END IF;

    -- Strict class and batch boundary verification:
    -- - If whole-class assignment (v_ta_batch_id IS NULL): student must belong to v_ta_class_id.
    -- - If batch-specific assignment (v_ta_batch_id IS NOT NULL): student must belong to v_ta_class_id AND have matching batch_id.
    IF NOT EXISTS (
      SELECT 1 FROM public.students
      WHERE id = v_student_id
        AND class_id = v_ta_class_id
        AND (v_ta_batch_id IS NULL OR (batch_id IS NOT NULL AND batch_id = v_ta_batch_id))
    ) THEN
      RAISE EXCEPTION 'Student % is not enrolled in class % (batch %)', v_student_id, v_ta_class_id, v_ta_batch_id;
    END IF;

    -- Upsert attendance record
    INSERT INTO public.attendance_records (
      session_id, student_id, status, marked_by, marked_at
    ) VALUES (
      v_session_id, v_student_id, v_status, auth.uid(), now()
    )
    ON CONFLICT (session_id, student_id) DO UPDATE
      SET status = EXCLUDED.status,
          marked_by = EXCLUDED.marked_by,
          marked_at = EXCLUDED.marked_at
    RETURNING id INTO v_record_id;

    -- Insert mandatory initial audit log entry
    INSERT INTO public.attendance_audit_log (
      record_id, old_status, new_status, changed_by, changed_at, reason
    ) VALUES (
      v_record_id, NULL, v_status, auth.uid(), now(), 'Initial submission'
    );

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'status', 'submitted',
    'records_processed', v_inserted_count
  );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.submit_attendance_session TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_attendance_session FROM anon;

-- ─── 5. WHOLE-CLASS TEACHING ASSIGNMENT UNIQUENESS ───────────────────

-- Verify that no conflicting duplicate whole-class assignments exist before adding index
DO $$
DECLARE
  v_dup_count INT;
  v_dup_details TEXT;
BEGIN
  SELECT COUNT(*), string_agg(format('prof_id: %s, subject_id: %s, class_id: %s (count: %s)', professor_id, subject_id, class_id, cnt), E'\n')
  INTO v_dup_count, v_dup_details
  FROM (
    SELECT professor_id, subject_id, class_id, COUNT(*) as cnt
    FROM public.teaching_assignments
    WHERE batch_id IS NULL
    GROUP BY professor_id, subject_id, class_id
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create partial unique index: % duplicate whole-class teaching assignment(s) found:\n%', v_dup_count, v_dup_details;
  END IF;
END;
$$;

-- Create partial unique index for whole-class assignments (where batch_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_teaching_assignments_whole_class
ON public.teaching_assignments (professor_id, subject_id, class_id)
WHERE batch_id IS NULL;
