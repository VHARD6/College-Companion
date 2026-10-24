-- ─────────────────────────────────────────────────────────────
-- MIGRATION 009: Timetable Studio (Master Timetables, Multi-Branch Grids, & Faculty Abbreviations)
-- 
-- 1. PROFESSOR ABBREVIATIONS:
--    - Adds explicit institutional abbreviation field (e.g. 'KVK', 'RYP') to public.professors.
--    - Avoids fragile dynamically inferred initials.
--
-- 2. MASTER TIMETABLES:
--    - Master schedule document header, cohort, semester, effective date, and publication lifecycle.
--
-- 3. UNIFORM PERIODS & BREAKS:
--    - Master timetable periods with start/end time, order, and break designations.
--
-- 4. MULTI-BRANCH COLUMNS:
--    - Columns mapped to classes/branches with custom display labels.
--
-- 5. SCHEDULED ENTRIES & SUBENTRIES:
--    - Multi-period practical lab blocks, batch-wise concurrent allocations, and full-width common breaks.
-- ─────────────────────────────────────────────────────────────

-- ─── 1. PROFESSOR ABBREVIATION EXTENSION ─────────────────────────────

ALTER TABLE public.professors
ADD COLUMN IF NOT EXISTS abbreviation TEXT;

-- ─── 2. MASTER TIMETABLES ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.master_timetables (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  academic_year     TEXT NOT NULL, -- e.g. '2026-27'
  semester          INT NOT NULL CHECK (semester BETWEEN 1 AND 8),
  cohort            TEXT NOT NULL, -- e.g. 'TE' or 'Third Year'
  effective_date    DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version           INT NOT NULL DEFAULT 1,
  header_title      TEXT,
  header_subtitle   TEXT,
  footer_notes      TEXT,
  published_png_url TEXT,
  created_by        UUID REFERENCES public.profiles(id),
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 3. PERIODS (TIME ROWS) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.master_timetable_periods (
  id            SERIAL PRIMARY KEY,
  timetable_id  INT NOT NULL REFERENCES public.master_timetables(id) ON DELETE CASCADE,
  period_order  INT NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  is_break      BOOLEAN NOT NULL DEFAULT false,
  break_label   TEXT,
  UNIQUE (timetable_id, period_order)
);

-- ─── 4. COLUMNS (BRANCH / CLASS HEADERS) ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.master_timetable_columns (
  id            SERIAL PRIMARY KEY,
  timetable_id  INT NOT NULL REFERENCES public.master_timetables(id) ON DELETE CASCADE,
  class_id      INT NOT NULL REFERENCES public.classes(id),
  column_order  INT NOT NULL,
  display_label TEXT NOT NULL,
  UNIQUE (timetable_id, class_id)
);

-- ─── 5. MASTER ENTRIES (SLOT BLOCKS & SPANS) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.master_timetable_entries (
  id                 SERIAL PRIMARY KEY,
  timetable_id       INT NOT NULL REFERENCES public.master_timetables(id) ON DELETE CASCADE,
  weekday            INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_period_id    INT NOT NULL REFERENCES public.master_timetable_periods(id),
  end_period_id      INT NOT NULL REFERENCES public.master_timetable_periods(id),
  column_id          INT REFERENCES public.master_timetable_columns(id) ON DELETE CASCADE,
  entry_type         TEXT NOT NULL CHECK (entry_type IN ('lecture', 'practical', 'tutorial', 'break')),
  common_break_label TEXT
);

-- ─── 6. SUBENTRIES (BATCH ALLOCATIONS, PROFESSORS, ROOMS) ────────────

CREATE TABLE IF NOT EXISTS public.master_timetable_subentries (
  id            SERIAL PRIMARY KEY,
  entry_id      INT NOT NULL REFERENCES public.master_timetable_entries(id) ON DELETE CASCADE,
  subject_id    INT NOT NULL REFERENCES public.subjects(id),
  professor_id  INT NOT NULL REFERENCES public.professors(id),
  batch_id      INT REFERENCES public.batches(id),
  room          TEXT
);

-- ─── 7. ROW LEVEL SECURITY POLICIES ──────────────────────────────────

ALTER TABLE public.master_timetables         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_timetable_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_timetable_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_timetable_subentries ENABLE ROW LEVEL SECURITY;

-- Master Timetables: Authenticated users can read published timetables; admins manage all
CREATE POLICY mt_read_published ON public.master_timetables
  FOR SELECT
  USING (
    status = 'published'
    OR public.get_my_role() = 'admin'
  );

CREATE POLICY mt_admin_all ON public.master_timetables
  FOR ALL
  USING (public.get_my_role() = 'admin');

-- Periods: readable if parent timetable is readable
CREATE POLICY mt_periods_read ON public.master_timetable_periods
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.master_timetables mt
      WHERE mt.id = timetable_id
        AND (mt.status = 'published' OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY mt_periods_admin ON public.master_timetable_periods
  FOR ALL
  USING (public.get_my_role() = 'admin');

-- Columns: readable if parent timetable is readable
CREATE POLICY mt_columns_read ON public.master_timetable_columns
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.master_timetables mt
      WHERE mt.id = timetable_id
        AND (mt.status = 'published' OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY mt_columns_admin ON public.master_timetable_columns
  FOR ALL
  USING (public.get_my_role() = 'admin');

-- Entries: readable if parent timetable is readable
CREATE POLICY mt_entries_read ON public.master_timetable_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.master_timetables mt
      WHERE mt.id = timetable_id
        AND (mt.status = 'published' OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY mt_entries_admin ON public.master_timetable_entries
  FOR ALL
  USING (public.get_my_role() = 'admin');

-- Subentries: readable if parent entry is readable
CREATE POLICY mt_subentries_read ON public.master_timetable_subentries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.master_timetable_entries mte
      JOIN public.master_timetables mt ON mt.id = mte.timetable_id
      WHERE mte.id = entry_id
        AND (mt.status = 'published' OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY mt_subentries_admin ON public.master_timetable_subentries
  FOR ALL
  USING (public.get_my_role() = 'admin');
