-- ─────────────────────────────────────────────────────────────
-- MIGRATION 016: First Year (FY) Curriculum Refactor
--
-- 1. STANDARDIZE MATHEMATICS TO EM-I [ST] ACROSS BOTH SEMESTERS:
--    - In First Year, there is no EM-II subject; the sole mathematics subject across
--      both Semester 1 and Semester 2 is EM-I [ST] (EM-I-ST, handled by Prof. ST).
--    - Provisions EM-I-ST teaching assignments for all Semester 2 classes
--      (CSE:AIML, ENTC, COMP, IT).
--    - Deletes obsolete EM-II-ST teaching assignments (IDs 41, 47, 53, 58).
--    - Removes EM-II-ST from public.subjects table.
--
-- 2. DECOUPLE WORKSHOP PRACTICES (WP-KVK) FROM DEFAULT MAIN POOLS:
--    - Workshop Practices (WP-KVK, handled by Prof. Ketan Karandikar) is an auxiliary
--      elective/conditional subject assigned only to students who do not take Engineering Graphics (EG).
--    - Removes WP-KVK from default whole-class teaching assignments for COMP (Sem 1),
--      IT (Sem 1), CSE:AIML (Sem 2), and ENTC (Sem 2).
--    - Preserves WP-KVK in public.subjects for elective/custom assignment.
--
-- 3. CLEAN UP DUPLICATE TEACHING ASSIGNMENTS:
--    - Removes duplicate whole-class teaching assignments for the same subject and class.
--    - Standardizes each First Year class division in both Semesters to exactly 5 core subjects:
--      * Pool A (5 subjects): EM-I, CHEM, EM, CS, PPS.
--      * Pool B (5 subjects): EM-I, PHY, BCME, BEEE, EG (EG-KVK for COMP/CSE:AIML; EG-AP for IT/ENTC).
-- ─────────────────────────────────────────────────────────────

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
  v_s_em1    INT;
  v_s_em2    INT;
  v_s_chem   INT;
  v_s_em     INT;
  v_s_cs     INT;
  v_s_pps    INT;
  v_s_phy    INT;
  v_s_bcme   INT;
  v_s_beee   INT;
  v_s_eg_kvk INT;
  v_s_eg_ap  INT;
  v_s_wp     INT;

  -- Professor IDs
  v_p_st  INT;
  v_p_pss INT;
  v_p_ryp INT;
  v_p_pp  INT;
  v_p_ak  INT;
  v_p_cdm INT;
  v_p_kvk INT;
  v_p_abi INT;
  v_p_ap  INT;
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
  SELECT id INTO v_s_em1    FROM public.subjects WHERE code = 'EM-I-ST';
  SELECT id INTO v_s_em2    FROM public.subjects WHERE code = 'EM-II-ST';
  SELECT id INTO v_s_chem   FROM public.subjects WHERE code = 'CHEM-PSS';
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
  SELECT pr.id INTO v_p_st  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%ST%' LIMIT 1;
  SELECT pr.id INTO v_p_pss FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Pritesh Shindade%' LIMIT 1;
  SELECT pr.id INTO v_p_ryp FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Rutuja Patil%' LIMIT 1;
  SELECT pr.id INTO v_p_pp  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Prof. PP%' LIMIT 1;
  SELECT pr.id INTO v_p_ak  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%AK%' LIMIT 1;
  SELECT pr.id INTO v_p_cdm FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Chandan Mahajan%' LIMIT 1;
  SELECT pr.id INTO v_p_kvk FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%Ketan Karandikar%' LIMIT 1;
  SELECT pr.id INTO v_p_abi FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%ABI%' LIMIT 1;
  SELECT pr.id INTO v_p_ap  FROM public.professors pr JOIN public.profiles p ON p.id = pr.user_id WHERE p.name ILIKE '%AP%' LIMIT 1;

  -- 1. Ensure EM-I-ST teaching assignment exists for all Sem 2 classes (v_c1_s2, v_c2_s2, v_c3_s2, v_c4_s2)
  IF v_p_st IS NOT NULL AND v_s_em1 IS NOT NULL THEN
    IF v_c1_s2 IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.teaching_assignments WHERE subject_id = v_s_em1 AND class_id = v_c1_s2 AND batch_id IS NULL
    ) THEN
      INSERT INTO public.teaching_assignments (professor_id, subject_id, class_id, batch_id) VALUES (v_p_st, v_s_em1, v_c1_s2, NULL);
    END IF;

    IF v_c2_s2 IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.teaching_assignments WHERE subject_id = v_s_em1 AND class_id = v_c2_s2 AND batch_id IS NULL
    ) THEN
      INSERT INTO public.teaching_assignments (professor_id, subject_id, class_id, batch_id) VALUES (v_p_st, v_s_em1, v_c2_s2, NULL);
    END IF;

    IF v_c3_s2 IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.teaching_assignments WHERE subject_id = v_s_em1 AND class_id = v_c3_s2 AND batch_id IS NULL
    ) THEN
      INSERT INTO public.teaching_assignments (professor_id, subject_id, class_id, batch_id) VALUES (v_p_st, v_s_em1, v_c3_s2, NULL);
    END IF;

    IF v_c4_s2 IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.teaching_assignments WHERE subject_id = v_s_em1 AND class_id = v_c4_s2 AND batch_id IS NULL
    ) THEN
      INSERT INTO public.teaching_assignments (professor_id, subject_id, class_id, batch_id) VALUES (v_p_st, v_s_em1, v_c4_s2, NULL);
    END IF;
  END IF;

  -- 2. Remove obsolete EM-II assignments (which have 0 sessions)
  IF v_s_em2 IS NOT NULL THEN
    DELETE FROM public.teaching_assignments ta
    WHERE ta.subject_id = v_s_em2
      AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.teaching_assignment_id = ta.id);
  END IF;

  -- 3. Delete EM-II from public.subjects
  IF v_s_em2 IS NOT NULL THEN
    DELETE FROM public.subjects WHERE id = v_s_em2;
  END IF;

  -- 4. Remove default whole-class WP-KVK assignments from all classes (COMP S1, IT S1, CSE:AIML S2, ENTC S2)
  -- Only when batch_id IS NULL and no sessions exist
  IF v_s_wp IS NOT NULL THEN
    DELETE FROM public.teaching_assignments ta
    WHERE ta.subject_id = v_s_wp
      AND ta.batch_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.teaching_assignment_id = ta.id);
  END IF;

  -- 5. Clean up duplicate whole-class teaching assignments for the same subject and class
  DELETE FROM public.teaching_assignments ta
  WHERE ta.id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY subject_id, class_id, COALESCE(batch_id, -1)
               ORDER BY (EXISTS (SELECT 1 FROM public.sessions s WHERE s.teaching_assignment_id = teaching_assignments.id)) DESC, id ASC
             ) as rn
      FROM public.teaching_assignments
    ) sub
    WHERE rn > 1
  )
  AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.teaching_assignment_id = ta.id);

END $$;
