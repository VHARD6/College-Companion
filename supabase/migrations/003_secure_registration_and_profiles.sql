-- ─────────────────────────────────────────────────────────────
-- MIGRATION 003: Secure Student Registration & Profile Creation
-- ─────────────────────────────────────────────────────────────

-- 1. Allow students table to store self-registered students who are pending class enrollment
ALTER TABLE public.students ALTER COLUMN class_id DROP NOT NULL;

-- 2. Hardened trigger function: handle_new_user()
-- Guarantees that public self-registrations ALWAYS receive the 'student' role.
-- Prevents clients from tampering with user_metadata to escalate privileges to 'professor' or 'admin'.
-- Automatically provisions a profile and pending student record.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  assigned_role TEXT := 'student';
  user_full_name TEXT;
  user_roll_no  TEXT;
BEGIN
  -- Extract and sanitize user's full name
  user_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1)
  );

  -- Extract optional roll number
  user_roll_no := NULLIF(TRIM(NEW.raw_user_meta_data->>'roll_no'), '');

  -- Insert profile, idempotent with ON CONFLICT
  INSERT INTO public.profiles (id, name, role, is_active, created_at)
  VALUES (NEW.id, user_full_name, assigned_role, true, now())
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active;

  -- If roll number was provided, optionally create a pending student record
  -- with NULL class_id until administrator completes class assignment.
  IF user_roll_no IS NOT NULL THEN
    INSERT INTO public.students (user_id, roll_no, class_id)
    VALUES (NEW.id, user_roll_no, NULL)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never crash auth user creation if an auxiliary table constraint fires
  RAISE WARNING 'handle_new_user auxiliary creation notice: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 3. Ensure trigger on auth.users is active
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Prevent non-admin users from updating profile roles or activating accounts
DROP POLICY IF EXISTS profiles_update_prevent_escalation ON public.profiles;
CREATE POLICY profiles_update_prevent_escalation ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    -- Non-admin users can update their own name, but CANNOT change their role or active status
    (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    )
    OR (
      id = auth.uid()
      AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
      AND is_active = (SELECT is_active FROM public.profiles WHERE id = auth.uid())
    )
  );
