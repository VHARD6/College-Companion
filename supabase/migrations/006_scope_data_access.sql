-- ─────────────────────────────────────────────────────────────
-- MIGRATION 006: Scoped Data Access, Attendance Submission Atomicity & Audit Hardening
-- 1. Scoped RLS policies for students, professors, and administrators
-- 2. Audit log immutability & table-level privilege revocation
-- 3. Session state transition and timestamp protection triggers
-- 4. Atomic database RPC functions for draft, submission, and correction
-- ─────────────────────────────────────────────────────────────

-- ─── 1. SCOPED RLS POLICIES ──────────────────────────────────

-- A. Students Table: Professors see only students they teach; students see self
DROP POLICY IF EXISTS students_self ON public.students;
DROP POLICY IF EXISTS students_self_read ON public.students;
DROP POLICY IF EXISTS students_prof_read ON public.students;

CREATE POLICY students_self_read ON public.students
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

CREATE POLICY students_prof_read ON public.students
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND class_id IN (
      SELECT ta.class_id
      FROM public.teaching_assignments ta
      WHERE ta.professor_id = public.get_my_professor_id()
        AND (ta.batch_id IS NULL OR ta.batch_id = students.batch_id)
    )
  );

-- B. Teaching Assignments: Professors see own; students see class assignments
DROP POLICY IF EXISTS ta_read ON public.teaching_assignments;
DROP POLICY IF EXISTS ta_prof_read ON public.teaching_assignments;
DROP POLICY IF EXISTS ta_student_read ON public.teaching_assignments;

CREATE POLICY ta_prof_read ON public.teaching_assignments
  FOR SELECT
  USING (
    public.get_my_role() = 'professor'
    AND professor_id = public.get_my_professor_id()
  );

CREATE POLICY ta_student_read ON public.teaching_assignments
  FOR SELECT
  USING (
    public.get_my_role() = 'student'
    AND class_id IN (
      SELECT s.class_id FROM public.students s WHERE s.id = public.get_my_student_id()
    )
    AND (
      batch_id IS NULL
      OR batch_id = (SELECT s.batch_id FROM public.students s WHERE s.id = public.get_my_student_id())
    )
  );

-- C. Timetable Slots: Scoped to professor assignments and student enrollment
DROP POLICY IF EXISTS tt_read ON public.timetable_slots;
DROP POLICY IF EXISTS tt_prof_read ON public.timetable_slots;
DROP POLICY IF EXISTS tt_student_read ON public.timetable_slots;

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
      WHERE ta.class_id = (SELECT s.class_id FROM public.students s WHERE s.id = public.get_my_student_id())
        AND (ta.batch_id IS NULL OR ta.batch_id = (SELECT s.batch_id FROM public.students s WHERE s.id = public.get_my_student_id()))
    )
  );

-- D. Sessions: Professors see own; students see only submitted sessions for their class
DROP POLICY IF EXISTS sessions_read ON public.sessions;
DROP POLICY IF EXISTS sessions_prof_read ON public.sessions;
DROP POLICY IF EXISTS sessions_student_read ON public.sessions;

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
      WHERE ta.class_id = (SELECT s.class_id FROM public.students s WHERE s.id = public.get_my_student_id())
        AND (ta.batch_id IS NULL OR ta.batch_id = (SELECT s.batch_id FROM public.students s WHERE s.id = public.get_my_student_id()))
    )
  );

-- E. Attendance Records: Students see own; professors see records within their assignments
DROP POLICY IF EXISTS ar_student_read ON public.attendance_records;
DROP POLICY IF EXISTS ar_prof_read ON public.attendance_records;

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

-- F. Profiles: Scoped to self, admin, and authorized academic links
DROP POLICY IF EXISTS profiles_self ON public.profiles;
DROP POLICY IF EXISTS profiles_read_scoped ON public.profiles;

CREATE POLICY profiles_read_scoped ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'professor'
      AND (
        id IN (
          SELECT s.user_id FROM public.students s
          JOIN public.teaching_assignments ta ON ta.class_id = s.class_id
          WHERE ta.professor_id = public.get_my_professor_id()
            AND (ta.batch_id IS NULL OR ta.batch_id = s.batch_id)
        )
        OR id IN (SELECT pr.user_id FROM public.professors pr)
      )
    )
    OR (
      public.get_my_role() = 'student'
      AND id IN (
        SELECT pr.user_id FROM public.professors pr
        JOIN public.teaching_assignments ta ON ta.professor_id = pr.id
        JOIN public.students s ON s.class_id = ta.class_id
        WHERE s.id = public.get_my_student_id()
          AND (ta.batch_id IS NULL OR ta.batch_id = s.batch_id)
      )
    )
  );

-- ─── 2. AUDIT LOG IMMUTABILITY & PRIVILEGES ──────────────────

-- Revoke UPDATE and DELETE on audit log for all roles
REVOKE UPDATE, DELETE ON public.attendance_audit_log FROM authenticated, anon, public;

-- Enforce append-only immutability via database trigger
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'attendance_audit_log entries are strictly append-only and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON public.attendance_audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.attendance_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_modification();

-- ─── 3. SESSION STATE TRANSITION PROTECTION ──────────────────

CREATE OR REPLACE FUNCTION public.protect_session_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Prevent reopening a submitted session as a draft
  IF OLD.status = 'submitted' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot reopen a submitted session as draft.';
  END IF;

  -- Prevent altering submitted_at once submitted (unless caller is admin)
  IF OLD.status = 'submitted' AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    IF public.get_my_role() != 'admin' THEN
      RAISE EXCEPTION 'submitted_at timestamp is authoritative and immutable.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_session_submission ON public.sessions;
CREATE TRIGGER trg_protect_session_submission
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_session_submission();

-- ─── 4. ATOMIC DATABASE RPC FUNCTIONS ────────────────────────

-- A. Submit Attendance Session (Atomic session update + records upsert + initial audit entries)
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
  -- 1. Verify caller role
  v_role := public.get_my_role();
  IF v_role NOT IN ('professor', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only active professors or admins can submit attendance';
  END IF;

  -- 2. Verify assignment ownership
  IF v_role = 'professor' THEN
    v_prof_id := public.get_my_professor_id();
    IF NOT EXISTS (
      SELECT 1 FROM public.teaching_assignments
      WHERE id = p_teaching_assignment_id AND professor_id = v_prof_id
    ) THEN
      RAISE EXCEPTION 'Forbidden: You are not authorized for teaching assignment %', p_teaching_assignment_id;
    END IF;
  END IF;

  -- 3. Validate assignment metadata
  SELECT class_id, batch_id INTO v_ta_class_id, v_ta_batch_id
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id;

  IF v_ta_class_id IS NULL THEN
    RAISE EXCEPTION 'Teaching assignment % not found', p_teaching_assignment_id;
  END IF;

  -- Date validation: cannot submit future attendance
  IF p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot mark attendance for a future date (%)', p_date;
  END IF;

  -- Validate session type
  IF p_session_type NOT IN ('lecture', 'practical', 'tutorial') THEN
    RAISE EXCEPTION 'Invalid session type: %', p_session_type;
  END IF;

  -- 4. Check existing session status
  IF v_session_id IS NOT NULL THEN
    SELECT status INTO v_existing_status FROM public.sessions WHERE id = v_session_id;
    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Session % has already been submitted. Use correction workflow for modifications.', v_session_id;
    END IF;
  ELSE
    SELECT id, status INTO v_session_id, v_existing_status
    FROM public.sessions
    WHERE teaching_assignment_id = p_teaching_assignment_id AND date = p_date
    LIMIT 1;

    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Attendance for this subject on % has already been submitted (session %).', p_date, v_session_id;
    END IF;
  END IF;

  -- 5. Upsert session as submitted with authoritative now()
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

  -- 6. Process attendance records and create audit log entries atomically
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
  LOOP
    v_student_id := (v_rec->>'student_id')::INT;
    v_status := v_rec->>'status';

    IF v_status NOT IN ('present', 'absent') THEN
      RAISE EXCEPTION 'Invalid attendance status "%" for student %', v_status, v_student_id;
    END IF;

    -- Verify student is enrolled in this class/batch
    IF NOT EXISTS (
      SELECT 1 FROM public.students
      WHERE id = v_student_id
        AND class_id = v_ta_class_id
        AND (v_ta_batch_id IS NULL OR batch_id = v_ta_batch_id)
    ) THEN
      RAISE EXCEPTION 'Student % is not enrolled in class % (batch %)', v_student_id, v_ta_class_id, v_ta_batch_id;
    END IF;

    -- Upsert record
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

    -- Insert initial audit entry
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

-- B. Correct Attendance Records (Atomic window check + changes + audit entries)
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

  -- 2. Caller role check
  v_role := public.get_my_role();
  IF v_role NOT IN ('professor', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only active professors or admins can perform attendance corrections.';
  END IF;

  -- 3. Session validation
  SELECT s.*, ta.professor_id INTO v_session
  FROM public.sessions s
  JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
  WHERE s.id = p_session_id;

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

  -- 5. Apply changes and write audit records
  FOR v_change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_student_id := (v_change->>'student_id')::INT;
    v_new_status := v_change->>'new_status';

    IF v_new_status NOT IN ('present', 'absent') THEN
      RAISE EXCEPTION 'Invalid status "%" for student %', v_new_status, v_student_id;
    END IF;

    -- Find existing record
    SELECT id, status INTO v_record_id, v_old_status
    FROM public.attendance_records
    WHERE session_id = p_session_id AND student_id = v_student_id;

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

-- C. Save Draft Session (Atomic draft creation / update without audit log)
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
  v_session_id INT := p_session_id;
  v_existing_status TEXT;
  v_rec JSONB;
  v_student_id INT;
  v_status TEXT;
  v_saved_count INT := 0;
BEGIN
  v_role := public.get_my_role();
  IF v_role NOT IN ('professor', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only professors or admins can save drafts';
  END IF;

  IF v_role = 'professor' THEN
    v_prof_id := public.get_my_professor_id();
    IF NOT EXISTS (
      SELECT 1 FROM public.teaching_assignments
      WHERE id = p_teaching_assignment_id AND professor_id = v_prof_id
    ) THEN
      RAISE EXCEPTION 'Forbidden: You are not authorized for teaching assignment %', p_teaching_assignment_id;
    END IF;
  END IF;

  -- Check if session already exists
  IF v_session_id IS NOT NULL THEN
    SELECT status INTO v_existing_status FROM public.sessions WHERE id = v_session_id;
    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Session % is already submitted and cannot be reverted to draft.', v_session_id;
    END IF;
  ELSE
    SELECT id, status INTO v_session_id, v_existing_status
    FROM public.sessions
    WHERE teaching_assignment_id = p_teaching_assignment_id AND date = p_date
    LIMIT 1;

    IF v_existing_status = 'submitted' THEN
      RAISE EXCEPTION 'Session on % is already submitted.', p_date;
    END IF;
  END IF;

  -- Upsert draft session
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

  -- Upsert draft attendance records
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
  LOOP
    v_student_id := (v_rec->>'student_id')::INT;
    v_status := v_rec->>'status';

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

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'status', 'draft',
    'records_saved', v_saved_count
  );
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.submit_attendance_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_attendance_records TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_draft_session TO authenticated;

-- Revoke from anonymous
REVOKE EXECUTE ON FUNCTION public.submit_attendance_session FROM anon;
REVOKE EXECUTE ON FUNCTION public.correct_attendance_records FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_draft_session FROM anon;
