-- ─────────────────────────────────────────────────────────────
-- MIGRATION 015: First Year (FY) Curriculum, Semester 2 Expansion & Scalable Branch Allotment
--
-- 1. FIRST YEAR SEMESTER 2 CLASSES & BATCHES:
--    - Creates Semester 2 classes for each of the 4 departments:
--      * CSE:AIML (Sem 2)
--      * ENTC (Sem 2)
--      * COMP (Sem 2)
--      * IT (Sem 2)
--    - Provisions practical batches (Batch 1, Batch 2) for each Sem 2 class.
--
-- 2. SUBJECT CATALOG ENHANCEMENT:
--    - Adds EM-II [ST] (Engineering Mathematics - II) for Semester 2.
--
-- 3. DYNAMIC TEACHING ASSIGNMENTS (FY INVERTED POOL ARCHITECTURE):
--    - Semester 1 Pool:
--      * CSE:AIML & ENTC: EM-1, CHEM, EM, CS, PPS (Pool A).
--      * COMP & IT: EM-1, PHY, BCME, BEEE, EG, WP (Pool B).
--    - Semester 2 Inverted Pool:
--      * CSE:AIML & ENTC: EM-2, PHY, BCME, BEEE, EG, WP (Inverted to Pool B).
--      * COMP & IT: EM-2, CHEM, EM, CS, PPS (Inverted to Pool A).
--
-- 4. SCALABLE BULK ENROLLMENT RPC:
--    - public.admin_bulk_assign_students allows administrators to allot tens, hundreds,
--      or thousands of student accounts to branches, classes, and batches in one atomic operation.
--    - Supports automatic round-robin batch distribution across available batches.
--
-- 5. TEST STUDENT ALLOTMENT:
--    - Divides the 20 test student accounts equally across the 4 branches (5 students per branch).
-- ─────────────────────────────────────────────────────────────

-- ─── 1. CREATE SEMESTER 2 CLASSES & BATCHES ───────────────────

INSERT INTO public.classes (department_id, name, semester, academic_year)
VALUES
  (1, 'CSE:AIML', 2, '2026-27'),
  (2, 'ENTC',     2, '2026-27'),
  (3, 'COMP',     2, '2026-27'),
  (4, 'IT',       2, '2026-27')
ON CONFLICT (department_id, name, semester, academic_year) DO NOTHING;

-- Provision batches for Semester 2 classes
INSERT INTO public.batches (class_id, name)
SELECT c.id, 'Batch 1'
FROM public.classes c
WHERE c.semester = 2
  AND NOT EXISTS (SELECT 1 FROM public.batches b WHERE b.class_id = c.id AND b.name = 'Batch 1');

INSERT INTO public.batches (class_id, name)
SELECT c.id, 'Batch 2'
FROM public.classes c
WHERE c.semester = 2
  AND NOT EXISTS (SELECT 1 FROM public.batches b WHERE b.class_id = c.id AND b.name = 'Batch 2');

-- ─── 2. SUBJECT CATALOG: EM-II [ST] ───────────────────────────

INSERT INTO public.subjects (name, code, department_id, semester, type)
VALUES ('EM-II [ST]', 'EM-II-ST', 1, 2, 'theory')
ON CONFLICT (code) DO NOTHING;

-- ─── 3. TEACHING ASSIGNMENTS (INVERTED POOL ALLOTMENT) ────────

DO $$
DECLARE
  -- Class IDs
  v_c1_s1 INT; -- CSE:AIML Sem 1
  v_c2_s1 INT; -- ENTC Sem 1
  v_c3_s1 INT; -- COMP Sem 1
  v_c4_s1 INT; -- IT Sem 1

  v_c1_s2 INT; -- CSE:AIML Sem 2
  v_c2_s2 INT; -- ENTC Sem 2
  v_c3_s2 INT; -- COMP Sem 2
  v_c4_s2 INT; -- IT Sem 2

  -- Subject IDs
  v_s_chem INT;
  v_s_em1  INT;
  v_s_em2  INT;
  v_s_em   INT;
  v_s_cs   INT;
  v_s_pps  INT;
  v_s_phy  INT;
  v_s_bcme INT;
  v_s_beee INT;
  v_s_eg_kvk INT;
  v_s_eg_ap  INT;
  v_s_wp   INT;

  -- Professor IDs
  v_p_pss INT;
  v_p_st  INT;
  v_p_ryp INT;
  v_p_pp  INT;
  v_p_ak  INT;
  v_p_cdm INT;
  v_p_kvk INT;
  v_p_abi INT;
  v_p_ap  INT;

  -- Local procedure helper
  assignments_to_insert RECORD;
BEGIN
  -- Resolve Class IDs
  SELECT id INTO v_c1_s1 FROM public.classes WHERE department_id = 1 AND semester = 1 LIMIT 1;
  SELECT id INTO v_c2_s1 FROM public.classes WHERE department_id = 2 AND semester = 1 LIMIT 1;
  SELECT id INTO v_c3_s1 FROM public.classes WHERE department_id = 3 AND semester = 1 LIMIT 1;
  SELECT id INTO v_c4_s1 FROM public.classes WHERE department_id = 4 AND semester = 1 LIMIT 1;

  SELECT id INTO v_c1_s2 FROM public.classes WHERE department_id = 1 AND semester = 2 LIMIT 1;
  SELECT id INTO v_c2_s2 FROM public.classes WHERE department_id = 2 AND semester = 2 LIMIT 1;
  SELECT id INTO v_c3_s2 FROM public.classes WHERE department_id = 3 AND semester = 2 LIMIT 1;
  SELECT id INTO v_c4_s2 FROM public.classes WHERE department_id = 4 AND semester = 2 LIMIT 1;

  -- Resolve Subject IDs
  SELECT id INTO v_s_chem   FROM public.subjects WHERE code = 'CHEM-PSS';
  SELECT id INTO v_s_em1    FROM public.subjects WHERE code = 'EM-I-ST';
  SELECT id INTO v_s_em2    FROM public.subjects WHERE code = 'EM-II-ST';
  SELECT id INTO v_s_em     FROM public.subjects WHERE code = 'EM-RYP';
  SELECT id INTO v_s_cs     FROM public.subjects WHERE code = 'CS-PP';
  SELECT id INTO v_s_pps    FROM public.subjects WHERE code = 'PPS-AK';
  SELECT id INTO v_s_phy    FROM public.subjects WHERE code = 'PHY-CDM';
  SELECT id INTO v_s_bcme   FROM public.subjects WHERE code = 'BCME-KVK';
  SELECT id INTO v_s_beee   FROM public.subjects WHERE code = 'BEEE-ABI';
  SELECT id INTO v_s_eg_kvk FROM public.subjects WHERE code = 'EG-KVK';
  SELECT id INTO v_s_eg_ap  FROM public.subjects WHERE code = 'EG-AP';
  SELECT id INTO v_s_wp     FROM public.subjects WHERE code = 'WP-KVK';

  -- Resolve Professor IDs
  SELECT pr.id INTO v_p_pss FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Pritesh Shindade%' LIMIT 1;
  SELECT pr.id INTO v_p_st  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%ST%' LIMIT 1;
  SELECT pr.id INTO v_p_ryp FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Rutuja Patil%' LIMIT 1;
  SELECT pr.id INTO v_p_pp  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Prof. PP%' LIMIT 1;
  SELECT pr.id INTO v_p_ak  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%AK%' LIMIT 1;
  SELECT pr.id INTO v_p_cdm FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Chandan Mahajan%' LIMIT 1;
  SELECT pr.id INTO v_p_kvk FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Ketan Karandikar%' LIMIT 1;
  SELECT pr.id INTO v_p_abi FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%ABI%' LIMIT 1;
  SELECT pr.id INTO v_p_ap  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%AP%' LIMIT 1;

  -- ── Clean up outdated assignments without sessions ──
  -- Remove WP from ENTC Sem 1 (TA 13) since ENTC Sem 1 only takes Pool A
  DELETE FROM public.teaching_assignments ta
  WHERE ta.class_id = v_c2_s1
    AND ta.subject_id = v_s_wp
    AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.teaching_assignment_id = ta.id);

  -- Remove duplicate teaching assignments if any (without sessions)
  DELETE FROM public.teaching_assignments ta
  WHERE ta.id IN (28, 29, 30, 31)
    AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.teaching_assignment_id = ta.id);

  -- ── Insert teaching assignments safely using NOT EXISTS on whole-class ──
  FOR assignments_to_insert IN
    SELECT * FROM (VALUES
      -- Pool A: CSE:AIML (Sem 1) -> EM-1, CHEM, EM, CS, PPS
      (v_p_st,  v_s_em1,  v_c1_s1),
      (v_p_pss, v_s_chem, v_c1_s1),
      (v_p_ryp, v_s_em,   v_c1_s1),
      (v_p_pp,  v_s_cs,   v_c1_s1),
      (v_p_ak,  v_s_pps,  v_c1_s1),

      -- Pool A: ENTC (Sem 1) -> EM-1, CHEM, EM, CS, PPS
      (v_p_st,  v_s_em1,  v_c2_s1),
      (v_p_pss, v_s_chem, v_c2_s1),
      (v_p_ryp, v_s_em,   v_c2_s1),
      (v_p_pp,  v_s_cs,   v_c2_s1),
      (v_p_ak,  v_s_pps,  v_c2_s1),

      -- Pool B: COMP (Sem 1) -> EM-1, PHY, BCME, BEEE, EG, WP
      (v_p_st,  v_s_em1,    v_c3_s1),
      (v_p_cdm, v_s_phy,    v_c3_s1),
      (v_p_kvk, v_s_bcme,   v_c3_s1),
      (v_p_abi, v_s_beee,   v_c3_s1),
      (v_p_kvk, v_s_eg_kvk, v_c3_s1),
      (v_p_kvk, v_s_wp,     v_c3_s1),

      -- Pool B: IT (Sem 1) -> EM-1, PHY, BCME, BEEE, EG, WP
      (v_p_st,  v_s_em1,    v_c4_s1),
      (v_p_cdm, v_s_phy,    v_c4_s1),
      (v_p_kvk, v_s_bcme,   v_c4_s1),
      (v_p_abi, v_s_beee,   v_c4_s1),
      (v_p_ap,  v_s_eg_ap,  v_c4_s1),
      (v_p_kvk, v_s_wp,     v_c4_s1),

      -- ── Semester 2 Inverted Pool ──
      -- CSE:AIML (Sem 2) -> Pool B (Inverted): EM-2, PHY, BCME, BEEE, EG, WP
      (v_p_st,  v_s_em2,    v_c1_s2),
      (v_p_cdm, v_s_phy,    v_c1_s2),
      (v_p_kvk, v_s_bcme,   v_c1_s2),
      (v_p_abi, v_s_beee,   v_c1_s2),
      (v_p_kvk, v_s_eg_kvk, v_c1_s2),
      (v_p_kvk, v_s_wp,     v_c1_s2),

      -- ENTC (Sem 2) -> Pool B (Inverted): EM-2, PHY, BCME, BEEE, EG, WP
      (v_p_st,  v_s_em2,    v_c2_s2),
      (v_p_cdm, v_s_phy,    v_c2_s2),
      (v_p_kvk, v_s_bcme,   v_c2_s2),
      (v_p_abi, v_s_beee,   v_c2_s2),
      (v_p_ap,  v_s_eg_ap,  v_c2_s2),
      (v_p_kvk, v_s_wp,     v_c2_s2),

      -- COMP (Sem 2) -> Pool A (Inverted): EM-2, CHEM, EM, CS, PPS
      (v_p_st,  v_s_em2,  v_c3_s2),
      (v_p_pss, v_s_chem, v_c3_s2),
      (v_p_ryp, v_s_em,   v_c3_s2),
      (v_p_pp,  v_s_cs,   v_c3_s2),
      (v_p_ak,  v_s_pps,  v_c3_s2),

      -- IT (Sem 2) -> Pool A (Inverted): EM-2, CHEM, EM, CS, PPS
      (v_p_st,  v_s_em2,  v_c4_s2),
      (v_p_pss, v_s_chem, v_c4_s2),
      (v_p_ryp, v_s_em,   v_c4_s2),
      (v_p_pp,  v_s_cs,   v_c4_s2),
      (v_p_ak,  v_s_pps,  v_c4_s2)
    ) AS t(prof_id, subj_id, cls_id)
  LOOP
    IF assignments_to_insert.prof_id IS NOT NULL 
       AND assignments_to_insert.subj_id IS NOT NULL 
       AND assignments_to_insert.cls_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        WHERE ta.professor_id = assignments_to_insert.prof_id
          AND ta.subject_id = assignments_to_insert.subj_id
          AND ta.class_id = assignments_to_insert.cls_id
          AND ta.batch_id IS NULL
      ) THEN
        INSERT INTO public.teaching_assignments (professor_id, subject_id, class_id, batch_id)
        VALUES (assignments_to_insert.prof_id, assignments_to_insert.subj_id, assignments_to_insert.cls_id, NULL);
      END IF;
    END IF;
  END LOOP;

END $$;

-- ─── 4. SCALABLE BULK ENROLLMENT RPC ──────────────────────────

CREATE OR REPLACE FUNCTION public.admin_bulk_assign_students(
  p_student_ids INT[],
  p_class_id INT,
  p_batch_id INT DEFAULT NULL,
  p_auto_distribute_batches BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_active BOOLEAN;
  v_batch_ids INT[];
  v_num_batches INT;
  v_idx INT;
  v_assigned_batch INT;
  v_student_id INT;
  v_updated_count INT := 0;
BEGIN
  -- 1. Authorization checks: Caller must be an active administrator
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  SELECT role, is_active INTO v_caller_role, v_caller_active
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: only an administrator can bulk assign students.';
  END IF;

  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: caller account is inactive';
  END IF;

  -- 2. Validate target class
  IF p_class_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id) THEN
    RAISE EXCEPTION 'Invalid target class id %', p_class_id;
  END IF;

  -- 3. Resolve batches for auto-distribution if requested
  IF p_auto_distribute_batches THEN
    SELECT ARRAY_AGG(id ORDER BY id) INTO v_batch_ids
    FROM public.batches
    WHERE class_id = p_class_id;

    v_num_batches := COALESCE(ARRAY_LENGTH(v_batch_ids, 1), 0);
  END IF;

  -- 4. Bulk update students
  v_idx := 0;
  FOREACH v_student_id IN ARRAY p_student_ids
  LOOP
    IF p_auto_distribute_batches AND v_num_batches > 0 THEN
      v_assigned_batch := v_batch_ids[(v_idx % v_num_batches) + 1];
    ELSIF p_batch_id IS NOT NULL THEN
      v_assigned_batch := p_batch_id;
    ELSE
      v_assigned_batch := NULL;
    END IF;

    UPDATE public.students
    SET class_id = p_class_id,
        batch_id = v_assigned_batch
    WHERE id = v_student_id;

    v_idx := v_idx + 1;
    v_updated_count := v_updated_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'class_id', p_class_id,
    'updated_count', v_updated_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bulk_assign_students(INT[], INT, INT, BOOLEAN) TO authenticated;

-- ─── 5. ALLOT 20 TEST STUDENTS EQUALLY TO 4 BRANCHES ──────────

DO $$
DECLARE
  v_c1 INT; -- CSE:AIML
  v_c2 INT; -- ENTC
  v_c3 INT; -- COMP
  v_c4 INT; -- IT

  -- Batch IDs
  v_b1_1 INT; v_b1_2 INT;
  v_b2_1 INT; v_b2_2 INT;
  v_b3_1 INT; v_b3_2 INT;
  v_b4_1 INT; v_b4_2 INT;
BEGIN
  SELECT id INTO v_c1 FROM public.classes WHERE department_id = 1 AND semester = 1 LIMIT 1;
  SELECT id INTO v_c2 FROM public.classes WHERE department_id = 2 AND semester = 1 LIMIT 1;
  SELECT id INTO v_c3 FROM public.classes WHERE department_id = 3 AND semester = 1 LIMIT 1;
  SELECT id INTO v_c4 FROM public.classes WHERE department_id = 4 AND semester = 1 LIMIT 1;

  SELECT id INTO v_b1_1 FROM public.batches WHERE class_id = v_c1 AND name = 'Batch 1' LIMIT 1;
  SELECT id INTO v_b1_2 FROM public.batches WHERE class_id = v_c1 AND name = 'Batch 2' LIMIT 1;

  SELECT id INTO v_b2_1 FROM public.batches WHERE class_id = v_c2 AND name = 'Batch 1' LIMIT 1;
  SELECT id INTO v_b2_2 FROM public.batches WHERE class_id = v_c2 AND name = 'Batch 2' LIMIT 1;

  SELECT id INTO v_b3_1 FROM public.batches WHERE class_id = v_c3 AND name = 'Batch 1' LIMIT 1;
  SELECT id INTO v_b3_2 FROM public.batches WHERE class_id = v_c3 AND name = 'Batch 2' LIMIT 1;

  SELECT id INTO v_b4_1 FROM public.batches WHERE class_id = v_c4 AND name = 'Batch 1' LIMIT 1;
  SELECT id INTO v_b4_2 FROM public.batches WHERE class_id = v_c4 AND name = 'Batch 2' LIMIT 1;

  -- 1. TEST01 to TEST05 -> Branch 1: CSE:AIML (Sem 1)
  UPDATE public.students SET class_id = v_c1, batch_id = v_b1_1 WHERE roll_no IN ('TEST01', 'TEST02', 'TEST03');
  UPDATE public.students SET class_id = v_c1, batch_id = v_b1_2 WHERE roll_no IN ('TEST04', 'TEST05');

  -- 2. TEST06 to TEST10 -> Branch 2: ENTC (Sem 1)
  UPDATE public.students SET class_id = v_c2, batch_id = v_b2_1 WHERE roll_no IN ('TEST06', 'TEST07', 'TEST08');
  UPDATE public.students SET class_id = v_c2, batch_id = v_b2_2 WHERE roll_no IN ('TEST09', 'TEST10');

  -- 3. TEST11 to TEST15 -> Branch 3: COMP (Sem 1)
  UPDATE public.students SET class_id = v_c3, batch_id = v_b3_1 WHERE roll_no IN ('TEST11', 'TEST12', 'TEST13');
  UPDATE public.students SET class_id = v_c3, batch_id = v_b3_2 WHERE roll_no IN ('TEST14', 'TEST15');

  -- 4. TEST16 to TEST20 -> Branch 4: IT (Sem 1)
  UPDATE public.students SET class_id = v_c4, batch_id = v_b4_1 WHERE roll_no IN ('TEST16', 'TEST17', 'TEST18');
  UPDATE public.students SET class_id = v_c4, batch_id = v_b4_2 WHERE roll_no IN ('TEST19', 'TEST20');
END $$;
