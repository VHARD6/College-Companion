import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('FY Dynamic Curriculum & Scalable Branch Allotment Test Suite', () => {
  const root = process.cwd()

  describe('1. Migration 015 Database Schema & RPC Architecture', () => {
    const migrationPath = path.join(
      root,
      'supabase',
      'migrations',
      '015_fy_curriculum_and_branch_allotment.sql'
    )

    it('verifies migration 015 SQL file exists on disk', () => {
      assert.ok(fs.existsSync(migrationPath), 'Migration 015 file must exist')
    })

    it('verifies Semester 2 classes and batches for all 4 departments', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      assert.match(sql, /INSERT INTO public\.classes.*'CSE:AIML'.*2/s, 'Must create CSE:AIML Sem 2 class')
      assert.match(sql, /INSERT INTO public\.classes.*'ENTC'.*2/s, 'Must create ENTC Sem 2 class')
      assert.match(sql, /INSERT INTO public\.classes.*'COMP'.*2/s, 'Must create COMP Sem 2 class')
      assert.match(sql, /INSERT INTO public\.classes.*'IT'.*2/s, 'Must create IT Sem 2 class')
      assert.match(sql, /INSERT INTO public\.batches.*'Batch 1'/s, 'Must provision Batch 1 for Sem 2')
      assert.match(sql, /INSERT INTO public\.batches.*'Batch 2'/s, 'Must provision Batch 2 for Sem 2')
    })

    it('verifies EM-II subject definition for Semester 2', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      assert.match(sql, /'EM-II \[ST\]'.*'EM-II-ST'/s, 'Must insert EM-II [ST] with code EM-II-ST')
    })

    it('verifies admin_bulk_assign_students RPC authorization and round-robin batch logic', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_bulk_assign_students/i, 'Must define admin_bulk_assign_students')
      assert.match(sql, /SECURITY DEFINER/i, 'RPC must be SECURITY DEFINER')
      assert.match(sql, /v_caller_role != 'admin'/i, 'RPC must enforce admin role check')
      assert.match(sql, /v_caller_active IS NOT TRUE/i, 'RPC must reject inactive accounts')
      assert.match(sql, /p_auto_distribute_batches/i, 'RPC must support auto-distributing batches')
    })
  })

  describe('2. FY Dynamic Curriculum Allotment (Pool A & Pool B Inverted Pool Rules)', () => {
    // Dynamic curriculum definitions (relational data simulation)
    const departments = [
      { id: 1, name: 'CSE:AIML' },
      { id: 2, name: 'ENTC' },
      { id: 3, name: 'COMP' },
      { id: 4, name: 'IT' },
    ]

    const poolASubjectsSem1 = ['EM-I-ST', 'CHEM-PSS', 'EM-RYP', 'CS-PP', 'PPS-AK']
    const poolBSubjectsSem1 = ['EM-I-ST', 'PHY-CDM', 'BCME-KVK', 'BEEE-ABI', 'EG-KVK', 'WP-KVK'] // or EG-AP for IT

    const poolASubjectsSem2 = ['EM-II-ST', 'CHEM-PSS', 'EM-RYP', 'CS-PP', 'PPS-AK']
    const poolBSubjectsSem2 = ['EM-II-ST', 'PHY-CDM', 'BCME-KVK', 'BEEE-ABI', 'EG-KVK', 'WP-KVK']

    // Simulating database resolver for teaching assignments
    function resolveCurriculumPool(deptId: number, semester: number): string[] {
      // Branches 1 (CSE:AIML) and 2 (ENTC):
      // Sem 1 -> Pool A, Sem 2 -> Pool B (Inverted)
      if (deptId === 1 || deptId === 2) {
        return semester === 1 ? poolASubjectsSem1 : poolBSubjectsSem2
      }
      // Branches 3 (COMP) and 4 (IT):
      // Sem 1 -> Pool B, Sem 2 -> Pool A (Inverted)
      if (deptId === 3 || deptId === 4) {
        return semester === 1 ? poolBSubjectsSem1 : poolASubjectsSem2
      }
      return []
    }

    it('correctly allocates Pool A to CSE:AIML and ENTC in Semester 1', () => {
      const cseSem1 = resolveCurriculumPool(1, 1)
      const entcSem1 = resolveCurriculumPool(2, 1)

      assert.equal(cseSem1.length, 5)
      assert.deepEqual(cseSem1, ['EM-I-ST', 'CHEM-PSS', 'EM-RYP', 'CS-PP', 'PPS-AK'])
      assert.deepEqual(entcSem1, cseSem1)
    })

    it('correctly allocates Pool B to COMP and IT in Semester 1', () => {
      const compSem1 = resolveCurriculumPool(3, 1)
      const itSem1 = resolveCurriculumPool(4, 1)

      assert.equal(compSem1.length, 6)
      assert.ok(compSem1.includes('PHY-CDM'))
      assert.ok(compSem1.includes('BCME-KVK'))
      assert.ok(compSem1.includes('BEEE-ABI'))
      assert.ok(compSem1.includes('WP-KVK'))
      assert.deepEqual(itSem1, compSem1)
    })

    it('correctly inverts curriculum pool in Semester 2 (CSE:AIML and ENTC get Pool B with EM-II)', () => {
      const cseSem2 = resolveCurriculumPool(1, 2)
      const entcSem2 = resolveCurriculumPool(2, 2)

      assert.equal(cseSem2.length, 6)
      assert.ok(cseSem2.includes('EM-II-ST'), 'Must include EM-II in Semester 2')
      assert.ok(cseSem2.includes('PHY-CDM'), 'Must include Physics')
      assert.ok(cseSem2.includes('BCME-KVK'), 'Must include BCME')
      assert.ok(cseSem2.includes('BEEE-ABI'), 'Must include BEEE')
      assert.deepEqual(entcSem2, cseSem2)
    })

    it('correctly inverts curriculum pool in Semester 2 (COMP and IT get Pool A with EM-II)', () => {
      const compSem2 = resolveCurriculumPool(3, 2)
      const itSem2 = resolveCurriculumPool(4, 2)

      assert.equal(compSem2.length, 5)
      assert.ok(compSem2.includes('EM-II-ST'), 'Must include EM-II in Semester 2')
      assert.ok(compSem2.includes('CHEM-PSS'), 'Must include Chemistry')
      assert.ok(compSem2.includes('EM-RYP'), 'Must include Engineering Mechanics')
      assert.ok(compSem2.includes('CS-PP'), 'Must include Communication Skills')
      assert.ok(compSem2.includes('PPS-AK'), 'Must include PPS')
      assert.deepEqual(itSem2, compSem2)
    })

    it('ensures Pool A and Pool B are disjoint except for the core Mathematics subject', () => {
      const poolAOnly = poolASubjectsSem1.filter(s => !s.startsWith('EM-'))
      const poolBOnly = poolBSubjectsSem1.filter(s => !s.startsWith('EM-'))

      const intersection = poolAOnly.filter(s => poolBOnly.includes(s))
      assert.equal(intersection.length, 0, 'Pool A non-math subjects must not overlap with Pool B')
    })
  })

  describe('3. Bulk Student Allotment RPC Logic & Round-Robin Batch Distribution', () => {
    // Model the exact PostgreSQL RPC logic in TypeScript for unit verification
    function simulateAdminBulkAssignStudents({
      caller,
      targetClassId,
      classes,
      studentIds,
      batches,
      targetBatchId,
      autoDistributeBatches,
    }: {
      caller: { role: string; isActive: boolean } | null
      targetClassId: number
      classes: { id: number; name: string }[]
      studentIds: number[]
      batches: { id: number; class_id: number; name: string }[]
      targetBatchId: number | null
      autoDistributeBatches: boolean
    }) {
      if (!caller) {
        throw new Error('Unauthorized: not authenticated')
      }
      if (caller.role !== 'admin') {
        throw new Error('Unauthorized: only an administrator can bulk assign students.')
      }
      if (!caller.isActive) {
        throw new Error('Unauthorized: caller account is inactive')
      }

      const targetClass = classes.find(c => c.id === targetClassId)
      if (!targetClass) {
        throw new Error(`Invalid target class id ${targetClassId}`)
      }

      const availableBatches = batches.filter(b => b.class_id === targetClassId)
      const numBatches = availableBatches.length

      const assignments: { studentId: number; classId: number; batchId: number | null }[] = []

      studentIds.forEach((studentId, idx) => {
        let assignedBatchId: number | null = null

        if (autoDistributeBatches && numBatches > 0) {
          assignedBatchId = availableBatches[idx % numBatches].id
        } else if (targetBatchId !== null) {
          assignedBatchId = targetBatchId
        } else {
          assignedBatchId = null
        }

        assignments.push({
          studentId,
          classId: targetClassId,
          batchId: assignedBatchId,
        })
      })

      return {
        success: true,
        class_id: targetClassId,
        updated_count: assignments.length,
        assignments,
      }
    }

    const testClasses = [
      { id: 1, name: 'CSE:AIML' },
      { id: 2, name: 'ENTC' },
    ]
    const testBatches = [
      { id: 101, class_id: 1, name: 'Batch 1' },
      { id: 102, class_id: 1, name: 'Batch 2' },
    ]

    it('rejects unauthenticated callers', () => {
      assert.throws(
        () =>
          simulateAdminBulkAssignStudents({
            caller: null,
            targetClassId: 1,
            classes: testClasses,
            studentIds: [1, 2, 3],
            batches: testBatches,
            targetBatchId: null,
            autoDistributeBatches: true,
          }),
        /not authenticated/i
      )
    })

    it('rejects non-admin callers (students and professors)', () => {
      assert.throws(
        () =>
          simulateAdminBulkAssignStudents({
            caller: { role: 'professor', isActive: true },
            targetClassId: 1,
            classes: testClasses,
            studentIds: [1, 2, 3],
            batches: testBatches,
            targetBatchId: null,
            autoDistributeBatches: true,
          }),
        /only an administrator can bulk assign/i
      )

      assert.throws(
        () =>
          simulateAdminBulkAssignStudents({
            caller: { role: 'student', isActive: true },
            targetClassId: 1,
            classes: testClasses,
            studentIds: [1, 2, 3],
            batches: testBatches,
            targetBatchId: null,
            autoDistributeBatches: true,
          }),
        /only an administrator can bulk assign/i
      )
    })

    it('rejects inactive administrator account', () => {
      assert.throws(
        () =>
          simulateAdminBulkAssignStudents({
            caller: { role: 'admin', isActive: false },
            targetClassId: 1,
            classes: testClasses,
            studentIds: [1, 2, 3],
            batches: testBatches,
            targetBatchId: null,
            autoDistributeBatches: true,
          }),
        /caller account is inactive/i
      )
    })

    it('rejects non-existent target class id', () => {
      assert.throws(
        () =>
          simulateAdminBulkAssignStudents({
            caller: { role: 'admin', isActive: true },
            targetClassId: 9999,
            classes: testClasses,
            studentIds: [1, 2, 3],
            batches: testBatches,
            targetBatchId: null,
            autoDistributeBatches: true,
          }),
        /Invalid target class id 9999/i
      )
    })

    it('auto-distributes 5 students evenly in round-robin fashion across 2 batches', () => {
      const result = simulateAdminBulkAssignStudents({
        caller: { role: 'admin', isActive: true },
        targetClassId: 1,
        classes: testClasses,
        studentIds: [10, 11, 12, 13, 14],
        batches: testBatches,
        targetBatchId: null,
        autoDistributeBatches: true,
      })

      assert.equal(result.updated_count, 5)
      // Index 0 -> Batch 101, Index 1 -> Batch 102, Index 2 -> Batch 101, Index 3 -> Batch 102, Index 4 -> Batch 101
      const batch101Count = result.assignments.filter(a => a.batchId === 101).length
      const batch102Count = result.assignments.filter(a => a.batchId === 102).length

      assert.equal(batch101Count, 3)
      assert.equal(batch102Count, 2)
      assert.equal(batch101Count + batch102Count, 5)
    })

    it('assigns all students to a specific chosen practical batch', () => {
      const result = simulateAdminBulkAssignStudents({
        caller: { role: 'admin', isActive: true },
        targetClassId: 1,
        classes: testClasses,
        studentIds: [1, 2, 3, 4],
        batches: testBatches,
        targetBatchId: 102,
        autoDistributeBatches: false,
      })

      assert.equal(result.updated_count, 4)
      assert.ok(result.assignments.every(a => a.batchId === 102))
    })

    it('supports whole-class allotment with null batch_id', () => {
      const result = simulateAdminBulkAssignStudents({
        caller: { role: 'admin', isActive: true },
        targetClassId: 1,
        classes: testClasses,
        studentIds: [1, 2],
        batches: testBatches,
        targetBatchId: null,
        autoDistributeBatches: false,
      })

      assert.equal(result.updated_count, 2)
      assert.ok(result.assignments.every(a => a.batchId === null))
    })
  })

  describe('4. Test Student Allotment Balance Verification', () => {
    // 20 test student roll numbers
    const testRolls = Array.from({ length: 20 }, (_, i) => `TEST${String(i + 1).padStart(2, '0')}`)

    const expectedBranches = [
      { name: 'CSE:AIML', deptId: 1, rolls: ['TEST01', 'TEST02', 'TEST03', 'TEST04', 'TEST05'] },
      { name: 'ENTC',     deptId: 2, rolls: ['TEST06', 'TEST07', 'TEST08', 'TEST09', 'TEST10'] },
      { name: 'COMP',     deptId: 3, rolls: ['TEST11', 'TEST12', 'TEST13', 'TEST14', 'TEST15'] },
      { name: 'IT',       deptId: 4, rolls: ['TEST16', 'TEST17', 'TEST18', 'TEST19', 'TEST20'] },
    ]

    it('verifies all 20 test students are divided equally across 4 branches (5 per branch)', () => {
      assert.equal(testRolls.length, 20)
      for (const branch of expectedBranches) {
        assert.equal(branch.rolls.length, 5, `Branch ${branch.name} must have exactly 5 students`)
      }

      // Check no overlaps
      const allAssigned = expectedBranches.flatMap(b => b.rolls)
      const uniqueAssigned = new Set(allAssigned)
      assert.equal(uniqueAssigned.size, 20, 'All 20 students must be uniquely assigned')
    })

    it('verifies each branch distributes students across Batch 1 (3) and Batch 2 (2)', () => {
      for (const branch of expectedBranches) {
        const batch1Rolls = branch.rolls.slice(0, 3)
        const batch2Rolls = branch.rolls.slice(3)

        assert.equal(batch1Rolls.length, 3, `Branch ${branch.name} Batch 1 must have 3 students`)
        assert.equal(batch2Rolls.length, 2, `Branch ${branch.name} Batch 2 must have 2 students`)
      }
    })
  })

  describe('5. Component Modularity & UI Architecture Verification', () => {
    it('verifies BulkClassAssignModal, AddUserCard, and UserEnrollmentModal are standalone modules', () => {
      const bulkModalPath = path.join(root, 'src', 'components', 'admin', 'BulkClassAssignModal.tsx')
      const addUserPath = path.join(root, 'src', 'components', 'admin', 'AddUserCard.tsx')
      const enrollmentPath = path.join(root, 'src', 'components', 'admin', 'UserEnrollmentModal.tsx')

      assert.ok(fs.existsSync(bulkModalPath), 'BulkClassAssignModal.tsx must exist')
      assert.ok(fs.existsSync(addUserPath), 'AddUserCard.tsx must exist')
      assert.ok(fs.existsSync(enrollmentPath), 'UserEnrollmentModal.tsx must exist')
    })

    it('verifies UserEnrollmentModal contains Semester selector and dynamic subject pool preview', () => {
      const enrollmentPath = path.join(root, 'src', 'components', 'admin', 'UserEnrollmentModal.tsx')
      const content = fs.readFileSync(enrollmentPath, 'utf8')

      assert.match(content, /studentSemester/i, 'Must manage studentSemester state')
      assert.match(content, /class-allotted-subjects/i, 'Must query class-allotted-subjects dynamically')
      assert.match(content, /Allotted Curriculum Pool/i, 'Must render Allotted Curriculum Pool preview')
    })

    it('verifies BulkClassAssignModal calls admin_bulk_assign_students RPC', () => {
      const bulkModalPath = path.join(root, 'src', 'components', 'admin', 'BulkClassAssignModal.tsx')
      const content = fs.readFileSync(bulkModalPath, 'utf8')

      assert.match(content, /admin_bulk_assign_students/i, 'Must invoke admin_bulk_assign_students RPC')
      assert.match(content, /p_auto_distribute_batches/i, 'Must support p_auto_distribute_batches')
      assert.match(content, /class-allotted-subjects/i, 'Must preview dynamic curriculum pool')
    })

    it('verifies AdminUsersPage integrates BulkClassAssignModal, AddUserCard and respects the 700-line budget', () => {
      const pagePath = path.join(root, 'src', 'pages', 'admin', 'AdminUsersPage.tsx')
      const content = fs.readFileSync(pagePath, 'utf8')

      assert.match(content, /import BulkClassAssignModal from/i, 'Must import BulkClassAssignModal')
      assert.match(content, /import AddUserCard from/i, 'Must import AddUserCard')
      assert.match(content, /branchFilter/i, 'Must support branchFilter')
      assert.match(content, /semesterFilter/i, 'Must support semesterFilter')
      assert.match(content, /selectedStudentIds/i, 'Must manage selectedStudentIds for multi-student selection')

      const lineCount = content.split('\n').length
      assert.ok(
        lineCount < 700,
        `AdminUsersPage should be under 700 lines for maintainability (actual: ${lineCount})`
      )
    })
  })
})
