-- ─────────────────────────────────────────────────────────────
-- MIGRATION 010: Streamlined Timetable Maker & Image Publishing
-- 
-- 1. PROFESSOR ABBREVIATIONS:
--    - Adds explicit institutional abbreviation field (e.g. 'KVK', 'RYP') to public.professors.
--
-- 2. PUBLISHED MASTER TIMETABLES (Single unified table):
--    - Stores daily/master timetable metadata, rendered high-res image URL,
--      daily announcements, and structured JSON grid data for easy template editing.
--    - Shared across all BTech branches (FY BTECH, CSE:AIML, ENTC, COMP, IT).
--
-- 3. STORAGE & ROW LEVEL SECURITY:
--    - Admin-only write permissions.
--    - Authenticated student/faculty read access.
-- ─────────────────────────────────────────────────────────────

-- ─── 1. PROFESSOR ABBREVIATION EXTENSION ─────────────────────────────
ALTER TABLE public.professors
ADD COLUMN IF NOT EXISTS abbreviation TEXT;

-- ─── 2. PUBLISHED MASTER TIMETABLES TABLE ────────────────────────────
CREATE TABLE IF NOT EXISTS public.published_master_timetables (
  id                SERIAL PRIMARY KEY,
  timetable_date    DATE NOT NULL,
  academic_year     TEXT NOT NULL DEFAULT '2026-27',
  semester          INT NOT NULL DEFAULT 1,
  class_name        TEXT NOT NULL DEFAULT 'FY BTECH',
  image_url         TEXT NOT NULL,
  storage_path      TEXT,
  announcement      TEXT,
  grid_data         JSONB,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by      UUID REFERENCES public.profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_timetable_date_class UNIQUE (timetable_date, class_name)
);

-- Index for speedy calendar/date lookup
CREATE INDEX IF NOT EXISTS idx_pmt_date ON public.published_master_timetables(timetable_date);

-- ─── 3. ROW LEVEL SECURITY POLICIES ──────────────────────────────────
ALTER TABLE public.published_master_timetables ENABLE ROW LEVEL SECURITY;

-- Students, professors, and admins can view published master timetables
CREATE POLICY pmt_read_all ON public.published_master_timetables
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can publish, update, or remove master timetables
CREATE POLICY pmt_admin_insert ON public.published_master_timetables
  FOR INSERT
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY pmt_admin_update ON public.published_master_timetables
  FOR UPDATE
  USING (public.get_my_role() = 'admin');

CREATE POLICY pmt_admin_delete ON public.published_master_timetables
  FOR DELETE
  USING (public.get_my_role() = 'admin');

-- ─── 4. SUPABASE STORAGE BUCKET CONFIGURATION (timetables) ───────────
-- Creates private 'timetables' bucket (public = false). Images require authenticated signed URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('timetables', 'timetables', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Authenticated-only read access for timetable images
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'timetables_authenticated_read'
  ) THEN
    CREATE POLICY "timetables_authenticated_read" ON storage.objects
      FOR SELECT
      USING (bucket_id = 'timetables' AND auth.uid() IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'timetables_admin_insert'
  ) THEN
    CREATE POLICY "timetables_admin_insert" ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'timetables' AND public.get_my_role() = 'admin');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'timetables_admin_update'
  ) THEN
    CREATE POLICY "timetables_admin_update" ON storage.objects
      FOR UPDATE
      USING (bucket_id = 'timetables' AND public.get_my_role() = 'admin');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'timetables_admin_delete'
  ) THEN
    CREATE POLICY "timetables_admin_delete" ON storage.objects
      FOR DELETE
      USING (bucket_id = 'timetables' AND public.get_my_role() = 'admin');
  END IF;
END $$;
