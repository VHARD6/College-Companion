-- ─────────────────────────────────────────────────────────────
-- MIGRATION 011: Harden Draft Attendance Session Authorization & Enrollment Boundaries
-- 
-- 1. AUTHORIZATION & ENROLLMENT ENFORCEMENT:
--    - Closes authorization gap in `save_draft_session` RPC where student IDs in `p_records`
--      were not validated against the teaching assignment's class and batch.
--    - Enforces that any student in `p_records` must be enrolled in the teaching assignment's class.
--    - For batch-specific assignments (ta.batch_id IS NOT NULL), enforces that students must
--      belong to that specific batch.
--    - Validates attendance status ('present' | 'absent').
--    - Prevents marking future-dated sessions (p_date > CURRENT_DATE).
--    - Validates session type ('lecture' | 'practical' | 'tutorial').
--
-- 2. ATOMICITY & ROLLBACK:
--    - The function executes inside a single PostgreSQL transaction.
--    - If any student record fails enrollment or status validation, `RAISE EXCEPTION` aborts
--      the transaction and rolls back all session creation and record writes.
--
-- 3. PERMISSIONS:
--    - SECURITY DEFINER with explicit search_path = public, pg_temp.
--    - Restricted to authenticated professors (owning the assignment) and admins.
--    - Explicitly revoked from anon.
-- ─────────────────────────────────────────────────────────────

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
  -- 1. Verify caller role
  v_role := public.get_my_role();
  IF v_role NOT IN ('professor', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only professors or admins can save drafts';
  END IF;

  -- 2. Verify assignment ownership if professor
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

  -- 4. Date and session type validation: cannot mark future dates
  IF p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot mark attendance for a future date (%)', p_date;
  END IF;

  IF p_session_type NOT IN ('lecture', 'practical', 'tutorial') THEN
    RAISE EXCEPTION 'Invalid session type: %', p_session_type;
  END IF;

  -- 5. Check if session exists and is already submitted
  IF v_session_id IS NOT NULL THEN
    SELECT status INTO v_existing_status
    FROM public.sessions
    WHERE id = v_session_id AND teaching_assignment_id = p_teaching_assignment_id;

    IF v_existing_status IS NULL THEN
      RAISE EXCEPTION 'Session % not found for teaching assignment %', v_session_id, p_teaching_assignment_id;
    END IF;

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

  -- 6. Upsert draft session
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

  -- 7. Validate each student's enrollment and status, then upsert draft attendance records
  -- Atomic: any exception aborts the transaction and rolls back session + all records
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

    -- Strict class and batch enrollment boundary verification:
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.save_draft_session TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_draft_session FROM anon;
