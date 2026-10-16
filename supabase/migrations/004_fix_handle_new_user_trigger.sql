-- ─────────────────────────────────────────────────────────────
-- MIGRATION 004: Repair and Harden Profile Creation Trigger
-- Fixes: relation "profiles" does not exist error by explicitly
-- setting search_path and qualifying public.profiles schema.
-- ─────────────────────────────────────────────────────────────

-- 1. Ensure students.class_id is nullable for pending self-registered students
ALTER TABLE IF EXISTS public.students ALTER COLUMN class_id DROP NOT NULL;

-- 2. Repair handle_new_user() with explicit schema references and search_path
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

  -- Insert profile into public.profiles
  -- Using explicit public schema qualification and idempotent ON CONFLICT
  INSERT INTO public.profiles (id, name, role, is_active, created_at)
  VALUES (NEW.id, user_full_name, assigned_role, true, now())
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active;

  -- If roll number was provided, provision pending row in public.students
  IF user_roll_no IS NOT NULL THEN
    INSERT INTO public.students (user_id, roll_no, class_id)
    VALUES (NEW.id, user_roll_no, NULL)
    ON CONFLICT (user_id) DO UPDATE
      SET roll_no = EXCLUDED.roll_no;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log warning to database logs without failing the parent auth transaction
  RAISE WARNING 'handle_new_user failed for auth.user id %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Grant execution permissions to auth admin
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin;

-- 3. Re-bind trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Idempotent Reconciliation Migration:
-- Reconcile any existing auth.users that missed profile creation due to the previous trigger failure
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

-- 5. RLS Policy: Prevent users from self-promoting to admin or professor
DROP POLICY IF EXISTS profiles_prevent_role_update ON public.profiles;
CREATE POLICY profiles_prevent_role_update ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    -- Only existing admins can change a profile's role or status
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      id = auth.uid()
      AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
      AND is_active = (SELECT is_active FROM public.profiles WHERE id = auth.uid())
    )
  );
