-- ─────────────────────────────────────────────────────────────
-- MIGRATION 014: Enforce Strict Role Exclusivity & Admin-Only Role Transitions
--
-- 1. ROLE MUTUAL EXCLUSIVITY:
--    - An account (profiles.id) can only occupy exactly one role: 'student', 'professor', or 'admin'.
--    - An account cannot co-exist in both public.students and public.professors.
--    - Accounts with role = 'admin' cannot have rows in public.students or public.professors.
--    - Accounts with role = 'student' cannot have rows in public.professors.
--    - Accounts with role = 'professor' cannot have rows in public.students.
--
-- 2. HARDENED ROLE RESOLUTION HELPER FUNCTIONS:
--    - get_my_professor_id() requires p.role = 'professor'.
--    - get_my_student_id() requires p.role = 'student'.
--    - get_my_student_class_id() requires p.role = 'student'.
--    - get_my_student_batch_id() requires p.role = 'student'.
--
-- 3. ADMIN-ONLY ROLE TRANSITIONS:
--    - Only authenticated administrators (role = 'admin', is_active = true) can assign or change roles.
--    - Atomic RPC procedure public.admin_set_user_role(...) manages transitions cleanly,
--      retiring conflicting auxiliary records (teaching assignments, student enrollments)
--      and preventing self-demotion lockout.
-- ─────────────────────────────────────────────────────────────

-- ─── 1. HARDEN SECURITY DEFINER ROLE RETRIEVAL HELPERS ─────────

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
  WHERE pr.user_id = auth.uid()
    AND p.is_active = true
    AND p.role = 'professor';

  RETURN v_id;
END;
$$;

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
  WHERE s.user_id = auth.uid()
    AND p.is_active = true
    AND p.role = 'student';

  RETURN v_id;
END;
$$;

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
  WHERE s.user_id = auth.uid()
    AND p.is_active = true
    AND p.role = 'student';

  RETURN v_class_id;
END;
$$;

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
  WHERE s.user_id = auth.uid()
    AND p.is_active = true
    AND p.role = 'student';

  RETURN v_batch_id;
END;
$$;

-- ─── 2. ENFORCE ROLE EXCLUSIVITY TRIGGERS ─────────────────────

-- Trigger on public.students
CREATE OR REPLACE FUNCTION public.check_student_role_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = NEW.user_id;

  IF v_role IS NULL OR v_role != 'student' THEN
    RAISE EXCEPTION 'Role exclusivity violation: user % has profile role %, cannot exist in students table',
      NEW.user_id, COALESCE(v_role, 'NULL');
  END IF;

  IF EXISTS (SELECT 1 FROM public.professors WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Role exclusivity violation: user % already exists in professors table', NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_role_exclusivity ON public.students;
CREATE TRIGGER trg_student_role_exclusivity
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.check_student_role_exclusivity();

-- Trigger on public.professors
CREATE OR REPLACE FUNCTION public.check_professor_role_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = NEW.user_id;

  IF v_role IS NULL OR v_role != 'professor' THEN
    RAISE EXCEPTION 'Role exclusivity violation: user % has profile role %, cannot exist in professors table',
      NEW.user_id, COALESCE(v_role, 'NULL');
  END IF;

  IF EXISTS (SELECT 1 FROM public.students WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Role exclusivity violation: user % already exists in students table', NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_professor_role_exclusivity ON public.professors;
CREATE TRIGGER trg_professor_role_exclusivity
  BEFORE INSERT OR UPDATE ON public.professors
  FOR EACH ROW EXECUTE FUNCTION public.check_professor_role_exclusivity();

-- Trigger on public.profiles
CREATE OR REPLACE FUNCTION public.check_profile_role_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. If role is changing, verify only administrator can change it
  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    IF current_user NOT IN ('postgres', 'supabase_admin') AND public.get_my_role() != 'admin' THEN
      RAISE EXCEPTION 'Unauthorized: only an administrator can change account roles.';
    END IF;
  END IF;

  -- 2. Validate role enum
  IF NEW.role NOT IN ('student', 'professor', 'admin') THEN
    RAISE EXCEPTION 'Invalid role: %', NEW.role;
  END IF;

  -- 3. Invariant checks for role mutual exclusivity
  IF NEW.role = 'admin' THEN
    IF EXISTS (SELECT 1 FROM public.students WHERE user_id = NEW.id) THEN
      RAISE EXCEPTION 'Role exclusivity violation: account % has role admin but exists in students table', NEW.id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.professors WHERE user_id = NEW.id) THEN
      RAISE EXCEPTION 'Role exclusivity violation: account % has role admin but exists in professors table', NEW.id;
    END IF;
  ELSIF NEW.role = 'student' THEN
    IF EXISTS (SELECT 1 FROM public.professors WHERE user_id = NEW.id) THEN
      RAISE EXCEPTION 'Role exclusivity violation: account % has role student but exists in professors table', NEW.id;
    END IF;
  ELSIF NEW.role = 'professor' THEN
    IF EXISTS (SELECT 1 FROM public.students WHERE user_id = NEW.id) THEN
      RAISE EXCEPTION 'Role exclusivity violation: account % has role professor but exists in students table', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_role_exclusivity ON public.profiles;
CREATE TRIGGER trg_profile_role_exclusivity
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_role_exclusivity();

-- ─── 3. HARDEN handle_new_user TRIGGER ────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  assigned_role TEXT := 'student';
  user_full_name TEXT;
  user_roll_no  TEXT;
BEGIN
  user_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1),
    'Student'
  );

  -- Only provision student record if role metadata is not admin/professor
  IF COALESCE(NEW.raw_user_meta_data->>'role', 'student') = 'student' THEN
    user_roll_no := NULLIF(TRIM(NEW.raw_user_meta_data->>'roll_no'), '');
  ELSE
    user_roll_no := NULL;
  END IF;

  -- Insert profile strictly as 'student'
  INSERT INTO public.profiles (id, name, role, is_active, created_at)
  VALUES (NEW.id, user_full_name, assigned_role, true, now())
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name;

  -- Provision student auxiliary record if roll number provided
  IF user_roll_no IS NOT NULL THEN
    INSERT INTO public.students (user_id, roll_no, class_id)
    VALUES (NEW.id, user_roll_no, NULL)
    ON CONFLICT (user_id) DO UPDATE
      SET roll_no = EXCLUDED.roll_no;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for auth.user id %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ─── 4. ATOMIC ADMIN ROLE TRANSITION RPC ─────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id UUID,
  p_new_role TEXT,
  p_roll_no TEXT DEFAULT NULL,
  p_class_id INT DEFAULT NULL,
  p_batch_id INT DEFAULT NULL,
  p_department_id INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_active BOOLEAN;
  v_target_profile RECORD;
  v_prof_id INT;
  v_student_id INT;
  v_dept_id INT;
  v_roll_no TEXT;
BEGIN
  -- 1. Authorization checks: Caller must be an active administrator
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  SELECT role, is_active INTO v_caller_role, v_caller_active
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: only an administrator can change account roles.';
  END IF;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: caller account is inactive';
  END IF;

  -- 2. Validate new role argument
  IF p_new_role NOT IN ('student', 'professor', 'admin') THEN
    RAISE EXCEPTION 'Invalid role: %. Must be student, professor, or admin.', p_new_role;
  END IF;

  -- 3. Fetch target user profile
  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found for id %', p_user_id;
  END IF;

  -- 4. Prevent administrator self-demotion lockout
  IF p_user_id = auth.uid() AND p_new_role != 'admin' THEN
    RAISE EXCEPTION 'Cannot demote your own administrator account. Please use another administrator account.';
  END IF;

  -- 5. Existing auxiliary record IDs
  SELECT id INTO v_prof_id FROM public.professors WHERE user_id = p_user_id;
  SELECT id INTO v_student_id FROM public.students WHERE user_id = p_user_id;

  -- ─── TRANSITION TO ADMIN ──────────────────────────────────
  IF p_new_role = 'admin' THEN
    -- Clean up professor records if any
    IF v_prof_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        JOIN public.sessions s ON s.teaching_assignment_id = ta.id
        WHERE ta.professor_id = v_prof_id
      ) THEN
        RAISE EXCEPTION 'Cannot reassign professor to admin: account has recorded class sessions. Please reassign teaching assignments first.';
      END IF;

      DELETE FROM public.master_timetable_subentries WHERE professor_id = v_prof_id;
      DELETE FROM public.timetable_slots
      WHERE teaching_assignment_id IN (
        SELECT id FROM public.teaching_assignments WHERE professor_id = v_prof_id
      );
      DELETE FROM public.teaching_assignments WHERE professor_id = v_prof_id;
      DELETE FROM public.professors WHERE user_id = p_user_id;
    END IF;

    -- Clean up student records if any
    IF v_student_id IS NOT NULL THEN
      DELETE FROM public.attendance_audit_log
      WHERE record_id IN (SELECT id FROM public.attendance_records WHERE student_id = v_student_id);
      DELETE FROM public.attendance_records WHERE student_id = v_student_id;
      DELETE FROM public.students WHERE user_id = p_user_id;
    END IF;

    -- Update profile role to admin
    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = p_user_id;

  -- ─── TRANSITION TO PROFESSOR ──────────────────────────────
  ELSIF p_new_role = 'professor' THEN
    -- Resolve department
    IF p_department_id IS NOT NULL THEN
      v_dept_id := p_department_id;
    ELSE
      SELECT department_id INTO v_dept_id FROM public.professors WHERE user_id = p_user_id;
      IF v_dept_id IS NULL THEN
        SELECT id INTO v_dept_id FROM public.departments ORDER BY id LIMIT 1;
      END IF;
    END IF;

    IF v_dept_id IS NULL THEN
      RAISE EXCEPTION 'Department assignment is required for professor role.';
    END IF;

    -- Clean up student record if transitioning from student
    IF v_student_id IS NOT NULL THEN
      DELETE FROM public.attendance_audit_log
      WHERE record_id IN (SELECT id FROM public.attendance_records WHERE student_id = v_student_id);
      DELETE FROM public.attendance_records WHERE student_id = v_student_id;
      DELETE FROM public.students WHERE user_id = p_user_id;
    END IF;

    -- Update profile role to professor
    UPDATE public.profiles
    SET role = 'professor'
    WHERE id = p_user_id;

    -- Upsert professor record
    INSERT INTO public.professors (user_id, department_id)
    VALUES (p_user_id, v_dept_id)
    ON CONFLICT (user_id) DO UPDATE
      SET department_id = EXCLUDED.department_id;

  -- ─── TRANSITION TO STUDENT ────────────────────────────────
  ELSIF p_new_role = 'student' THEN
    -- Resolve roll number
    v_roll_no := TRIM(COALESCE(p_roll_no, (SELECT roll_no FROM public.students WHERE user_id = p_user_id), ''));
    IF v_roll_no = '' THEN
      v_roll_no := split_part(v_target_profile.name, ' ', 1);
      IF v_roll_no = '' THEN
        v_roll_no := 'STU-' || SUBSTRING(p_user_id::TEXT FROM 1 FOR 6);
      END IF;
    END IF;

    -- Check roll number collision with another student
    IF EXISTS (SELECT 1 FROM public.students WHERE roll_no = v_roll_no AND user_id != p_user_id) THEN
      RAISE EXCEPTION 'Roll number "%" is already assigned to another student.', v_roll_no;
    END IF;

    -- Clean up professor record if transitioning from professor
    IF v_prof_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        JOIN public.sessions s ON s.teaching_assignment_id = ta.id
        WHERE ta.professor_id = v_prof_id
      ) THEN
        RAISE EXCEPTION 'Cannot reassign professor to student: account has recorded class sessions. Please reassign teaching assignments first.';
      END IF;

      DELETE FROM public.master_timetable_subentries WHERE professor_id = v_prof_id;
      DELETE FROM public.timetable_slots
      WHERE teaching_assignment_id IN (
        SELECT id FROM public.teaching_assignments WHERE professor_id = v_prof_id
      );
      DELETE FROM public.teaching_assignments WHERE professor_id = v_prof_id;
      DELETE FROM public.professors WHERE user_id = p_user_id;
    END IF;

    -- Update profile role to student
    UPDATE public.profiles
    SET role = 'student'
    WHERE id = p_user_id;

    -- Upsert student record
    INSERT INTO public.students (user_id, roll_no, class_id, batch_id)
    VALUES (p_user_id, v_roll_no, p_class_id, p_batch_id)
    ON CONFLICT (user_id) DO UPDATE
      SET roll_no = EXCLUDED.roll_no,
          class_id = EXCLUDED.class_id,
          batch_id = EXCLUDED.batch_id;

  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', p_new_role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, TEXT, TEXT, INT, INT, INT) TO authenticated;
