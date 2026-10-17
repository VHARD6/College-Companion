-- ─────────────────────────────────────────────────────────────
-- MIGRATION 008: Harden Role Reconciliation & Enforce Strict Batch Boundaries
-- 
-- 1. BATCH BOUNDARY HARDENING:
--    In Migration 007, `can_access_student_roster(p_class_id, p_batch_id)` included:
--      `(ta.batch_id IS NULL OR p_batch_id IS NULL OR ta.batch_id = p_batch_id)`
--    When a professor was assigned to a specific practical batch (ta.batch_id = 1),
--    a student with `p_batch_id IS NULL` (unassigned or common) matched `p_batch_id IS NULL`
--    and was improperly exposed to that batch-specific professor.
--    This migration fixes the condition to:
--      `(ta.batch_id IS NULL OR (p_batch_id IS NOT NULL AND ta.batch_id = p_batch_id))`
--    Now:
--    - Whole-class assignments (ta.batch_id IS NULL) can access all students.
--    - Batch-specific assignments (ta.batch_id IS NOT NULL) can ONLY access students
--      explicitly enrolled in that specific batch. Students with NULL batch_id are excluded.
--
-- 2. ORPHAN PROFILE RECONCILIATION HARDENING:
--    - NEVER trust `raw_user_meta_data->>'role'`. User metadata is client-writable.
--    - Missing profiles are reconciled with the safe default role 'student'.
--    - Existing profiles are NEVER overwritten or demoted/promoted.
--
-- 3. TRIGGER REINFORCEMENT:
--    - Ensure `handle_new_user()` strictly assigns role = 'student' regardless of metadata.
-- ─────────────────────────────────────────────────────────────

-- ─── 1. HARDEN BATCH BOUNDARY CHECK IN can_access_student_roster ──────

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
      AND (
        ta.batch_id IS NULL 
        OR (p_batch_id IS NOT NULL AND ta.batch_id = p_batch_id)
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_student_roster(INT, INT) TO authenticated, anon;

-- ─── 2. REINFORCE handle_new_user TRIGGER ────────────────────────────

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
  -- Extract and sanitize user's full name, fallback to email prefix if not supplied
  user_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1),
    'Student'
  );

  -- Extract optional roll number provided during student registration
  user_roll_no := NULLIF(TRIM(NEW.raw_user_meta_data->>'roll_no'), '');

  -- Insert profile strictly as 'student'
  -- ON CONFLICT: DO NOT overwrite role or is_active
  INSERT INTO public.profiles (id, name, role, is_active, created_at)
  VALUES (NEW.id, user_full_name, assigned_role, true, now())
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name;

  -- If roll number was provided, provision pending row in public.students
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

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin;

-- ─── 3. SAFE, SECURE ORPHAN RECONCILIATION ────────────────────────────

-- Only insert missing profiles. NEVER update existing profiles.
-- All reconciled profiles receive role = 'student' (zero privilege escalation).
INSERT INTO public.profiles (id, name, role, is_active, created_at)
SELECT 
  u.id,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1), 'User'),
  'student', -- Safe hardcoded default; NEVER read role from client-writable metadata
  true,
  COALESCE(u.created_at, now())
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
