-- ─────────────────────────────────────────────────────────────
-- MIGRATION 013: Harden Inactive Account RPC Authorization, Session Creation Concurrency & Audit Policy Cleanup
--
-- 1. ELIMINATE NULL-ROLE AUTHORIZATION BYPASS (POSTGRESQL TRI-STATE LOGIC):
--    - In PostgreSQL, three-valued logic causes `NULL NOT IN ('professor', 'admin')` to evaluate
--      to NULL (unknown), which skips `IF v_role NOT IN ('professor', 'admin') THEN` statements.
--    - When `get_my_role()` returns NULL (for inactive accounts with is_active = false or invalid profiles),
--      callers previously bypassed role rejection in `submit_attendance_session`, `save_draft_session`,
--      and `correct_attendance_records`.
--    - Explicitly guard with `IF v_role IS NULL OR v_role NOT IN ('professor', 'admin') THEN` at the start
--      of each RPC function to guarantee inactive or unauthenticated accounts are rejected immediately.
--
-- 2. HARDEN SESSION CREATION CONCURRENCY & PREVENT DUPLICATE SESSIONS:
--    - When creating a session without a supplied session ID (p_session_id IS NULL), `SELECT ... FOR UPDATE`
--      only locks existing rows; if no row exists yet, concurrent transactions can both find no row
--      and create duplicate sessions for the same teaching assignment and date.
--    - Acquire a transaction-level advisory lock (`pg_advisory_xact_lock(hashtext(format('session:%s:%s', ...)))`)
--      in both `submit_attendance_session` and `save_draft_session`.
--    - The advisory lock automatically serializes concurrent creation attempts for the same assignment/date
--      and is automatically released when the transaction commits or aborts.
--    - Cross-assignment validation, submitted-session immutability, class/batch boundary validation,
--      atomic transactions, and mandatory audit logging are strictly preserved.
--
-- 3. CLEAN UP OBSOLETE AUDIT LOG WRITE POLICIES:
--    - Migration 007 left lingering `audit_admin` (FOR ALL) and `audit_prof_insert` (FOR INSERT) policies
--      on `public.attendance_audit_log`.
--    - Migration 012 revoked table privileges, but removing obsolete direct-write RLS policies prevents
--      accidental write re-opening if table privileges are adjusted in future migrations.
--    - Preserve legitimate SELECT read policies (`audit_admin_read`, `audit_prof_read`) for administrators
--      and teaching professors.
-- ─────────────────────────────────────────────────────────────

-- ─── 1. CLEAN UP OBSOLETE AUDIT LOG POLICIES & PRESERVE READ POLICIES ──

-- Drop obsolete direct-write and permissive ALL policies
DROP POLICY IF EXISTS audit_admin ON public.attendance_audit_log;
DROP POLICY IF EXISTS audit_prof_insert ON public.attendance_audit_log;
DROP POLICY IF EXISTS audit_insert ON public.attendance_audit_log;

-- Reaffirm administrator read-only access
DROP POLICY IF EXISTS audit_admin_read ON public.attendance_audit_log;
CREATE POLICY audit_admin_read ON public.attendance_audit_log
  FOR SELECT
  USING (public.get_my_role() = 'admin');

-- Reaffirm professor read-only access (scoped strictly to their own teaching assignments)
DROP POLICY IF EXISTS audit_prof_read ON public.attendance_audit_log;
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

-- Reaffirm table privilege restrictions (defense-in-depth at privilege layer)
REVOKE INSERT, UPDATE, DELETE ON public.attendance_audit_log FROM authenticated, anon, public;
GRANT SELECT ON public.attendance_audit_log TO authenticated;

-- ─── 2. HARDEN submit_attendance_session RPC ─────────────────────────

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
  -- 1. Explicit caller role check (defense against PostgreSQL tri-state logic on NULL)
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('professor', 'admin') THEN
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

  -- Validate student records payload is non-empty
  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'Cannot submit attendance session with empty student records.';
  END IF;

  -- 5. Concurrency protection: acquire transaction-level advisory lock on assignment + date
  -- Prevents concurrent transactions from racing on initial session creation
  PERFORM pg_advisory_xact_lock(hashtext(format('session:%s:%s', p_teaching_assignment_id, p_date)));

  -- 6. Safe session ownership and status verification with row-level locking (FOR UPDATE)
  IF v_session_id IS NOT NULL THEN
    SELECT status INTO v_existing_status
    FROM public.sessions
    WHERE id = v_session_id AND teaching_assignment_id = p_teaching_assignment_id
    FOR UPDATE;

    IF v_existing_status IS NULL THEN
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
    SELECT id, status INTO v_session_id, v_existing_status
    FROM public.sessions
    WHERE teaching_assignment_id = p_teaching_assignment_id AND date = p_date
    FOR UPDATE
    LIMIT 1;

    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Attendance for this subject on % has already been submitted (session %).', p_date, v_session_id;
    END IF;
  END IF;

  -- 7. Upsert session as submitted with authoritative server timestamp now()
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

  -- 8. Validate each student's enrollment and upsert attendance records atomically
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

    -- Strict class and batch enrollment boundary check
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

GRANT EXECUTE ON FUNCTION public.submit_attendance_session TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_attendance_session FROM anon;

-- ─── 3. HARDEN save_draft_session RPC ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_draft_session(
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
  v_saved_count INT := 0;
BEGIN
  -- 1. Explicit caller role check (defense against PostgreSQL tri-state logic on NULL)
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('professor', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only active professors or admins can save drafts';
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

  -- 4. Date and session type validation
  IF p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot mark attendance for a future date (%)', p_date;
  END IF;

  IF p_session_type NOT IN ('lecture', 'practical', 'tutorial') THEN
    RAISE EXCEPTION 'Invalid session type: %', p_session_type;
  END IF;

  -- 5. Concurrency protection: acquire transaction-level advisory lock on assignment + date
  -- Prevents concurrent transactions from racing on initial draft session creation
  PERFORM pg_advisory_xact_lock(hashtext(format('session:%s:%s', p_teaching_assignment_id, p_date)));

  -- 6. Check existing session status and verify assignment ownership with row lock (FOR UPDATE)
  IF v_session_id IS NOT NULL THEN
    SELECT status INTO v_existing_status
    FROM public.sessions
    WHERE id = v_session_id AND teaching_assignment_id = p_teaching_assignment_id
    FOR UPDATE;

    IF v_existing_status IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.sessions WHERE id = v_session_id) THEN
        RAISE EXCEPTION 'Session % does not belong to teaching assignment %', v_session_id, p_teaching_assignment_id;
      ELSE
        RAISE EXCEPTION 'Session % not found for teaching assignment %', v_session_id, p_teaching_assignment_id;
      END IF;
    END IF;

    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Session % is already submitted and cannot be reverted to draft.', v_session_id;
    END IF;
  ELSE
    SELECT id, status INTO v_session_id, v_existing_status
    FROM public.sessions
    WHERE teaching_assignment_id = p_teaching_assignment_id AND date = p_date
    FOR UPDATE
    LIMIT 1;

    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Session on % is already submitted.', p_date;
    END IF;
  END IF;

  -- 7. Upsert draft session
  IF v_session_id IS NULL THEN
    INSERT INTO public.sessions (
      teaching_assignment_id, date, session_type, status, submitted_at, submitted_by
    ) VALUES (
      p_teaching_assignment_id, p_date, p_session_type, 'draft', NULL, NULL
    ) RETURNING id INTO v_session_id;
  ELSE
    UPDATE public.sessions
    SET date = p_date,
        session_type = p_session_type
    WHERE id = v_session_id;
  END IF;

  -- 8. Validate each student's enrollment and upsert draft attendance records atomically
  IF p_records IS NOT NULL AND jsonb_typeof(p_records) = 'array' THEN
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
      v_student_id := (v_rec->>'student_id')::INT;
      v_status := v_rec->>'status';

      IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Missing or invalid student_id in draft records';
      END IF;

      IF v_status NOT IN ('present', 'absent') THEN
        RAISE EXCEPTION 'Invalid attendance status "%" for student %', v_status, v_student_id;
      END IF;

      -- Strict class and batch enrollment boundary check
      IF NOT EXISTS (
        SELECT 1 FROM public.students
        WHERE id = v_student_id
          AND class_id = v_ta_class_id
          AND (v_ta_batch_id IS NULL OR (batch_id IS NOT NULL AND batch_id = v_ta_batch_id))
      ) THEN
        RAISE EXCEPTION 'Student % is not enrolled in class % (batch %)', v_student_id, v_ta_class_id, v_ta_batch_id;
      END IF;

      INSERT INTO public.attendance_records (
        session_id, student_id, status, marked_by, marked_at
      ) VALUES (
        v_session_id, v_student_id, v_status, auth.uid(), now()
      )
      ON CONFLICT (session_id, student_id) DO UPDATE
        SET status = EXCLUDED.status,
            marked_by = EXCLUDED.marked_by,
            marked_at = EXCLUDED.marked_at;

      v_saved_count := v_saved_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'status', 'draft',
    'records_saved', v_saved_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_draft_session TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_draft_session FROM anon;

-- ─── 4. HARDEN correct_attendance_records RPC ────────────────────────

CREATE OR REPLACE FUNCTION public.correct_attendance_records(
  p_session_id INT,
  p_changes JSONB,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_prof_id INT;
  v_session RECORD;
  v_window_hrs INT;
  v_change JSONB;
  v_student_id INT;
  v_new_status TEXT;
  v_old_status TEXT;
  v_record_id INT;
  v_changes_applied INT := 0;
BEGIN
  -- 1. Reason validation: non-empty is mandatory
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A non-empty reason is mandatory for attendance corrections.';
  END IF;

  -- 2. Explicit caller role check (defense against PostgreSQL tri-state logic on NULL)
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('professor', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only active professors or admins can perform attendance corrections.';
  END IF;

  -- 3. Session validation with row-level lock
  SELECT s.*, ta.professor_id INTO v_session
  FROM public.sessions s
  JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
  WHERE s.id = p_session_id
  FOR UPDATE OF s;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session % not found.', p_session_id;
  END IF;

  IF v_session.status != 'submitted' THEN
    RAISE EXCEPTION 'Session % is not submitted. Use standard submission instead.', p_session_id;
  END IF;

  -- Verify professor owns this session (admin can override)
  IF v_role = 'professor' THEN
    v_prof_id := public.get_my_professor_id();
    IF v_session.professor_id != v_prof_id THEN
      RAISE EXCEPTION 'Forbidden: You do not have permission to modify another professor''s session.';
    END IF;

    -- 4. Check correction window against authoritative database now()
    SELECT COALESCE(correction_window_hrs, 24) INTO v_window_hrs
    FROM public.attendance_policy
    LIMIT 1;

    IF v_session.submitted_at IS NULL OR (now() - v_session.submitted_at) > (v_window_hrs || ' hours')::interval THEN
      RAISE EXCEPTION 'Correction window (% hours) has expired for session %. Modification locked.', v_window_hrs, p_session_id;
    END IF;
  END IF;

  -- 5. Apply changes and write audit records atomically
  IF p_changes IS NULL OR jsonb_typeof(p_changes) != 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'No changes provided for attendance correction.';
  END IF;

  FOR v_change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_student_id := (v_change->>'student_id')::INT;
    v_new_status := v_change->>'new_status';

    IF v_student_id IS NULL THEN
      RAISE EXCEPTION 'Missing or invalid student_id in correction changes.';
    END IF;

    IF v_new_status NOT IN ('present', 'absent') THEN
      RAISE EXCEPTION 'Invalid status "%" for student %', v_new_status, v_student_id;
    END IF;

    -- Find existing record with row-level lock
    SELECT id, status INTO v_record_id, v_old_status
    FROM public.attendance_records
    WHERE session_id = p_session_id AND student_id = v_student_id
    FOR UPDATE;

    IF v_record_id IS NULL THEN
      RAISE EXCEPTION 'Attendance record not found for student % in session %', v_student_id, p_session_id;
    END IF;

    -- Only apply if status actually changed
    IF v_old_status != v_new_status THEN
      UPDATE public.attendance_records
      SET status = v_new_status,
          marked_by = auth.uid(),
          marked_at = now()
      WHERE id = v_record_id;

      INSERT INTO public.attendance_audit_log (
        record_id, old_status, new_status, changed_by, changed_at, reason
      ) VALUES (
        v_record_id, v_old_status, v_new_status, auth.uid(), now(), trim(p_reason)
      );

      v_changes_applied := v_changes_applied + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'changes_applied', v_changes_applied
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.correct_attendance_records TO authenticated;
REVOKE EXECUTE ON FUNCTION public.correct_attendance_records FROM anon;
