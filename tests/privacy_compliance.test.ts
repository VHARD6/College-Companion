import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('DPDP Act 2023 & Institutional Privacy Compliance Test Suite', () => {
  const rootDir = process.cwd()

  it('verifies PrivacyPolicyPage exists and contains required DPDP Act 2023 provisions', () => {
    const policyPath = path.join(rootDir, 'src', 'pages', 'public', 'PrivacyPolicyPage.tsx')
    assert.ok(fs.existsSync(policyPath), 'PrivacyPolicyPage.tsx must exist')

    const content = fs.readFileSync(policyPath, 'utf8')

    // 1. Data Fiduciary / Processor clarity
    assert.match(content, /Data Fiduciary/i, 'Must clarify Data Fiduciary role')
    assert.match(content, /Data Processor/i, 'Must clarify Data Processor role')

    // 2. DPDP Act 2023 citation
    assert.match(content, /Digital Personal Data Protection/i, 'Must reference DPDP Act')
    assert.match(content, /DPDP Act/i, 'Must reference DPDP Act abbreviation')

    // 3. Section 9: Minor / under 18 student data protections
    assert.match(content, /Section 9/i, 'Must address Section 9 of DPDP Act 2023')
    assert.match(content, /under 18/i, 'Must specify policy for students under 18')

    // 4. Section 13: Grievance Redressal Officer (DPO) and timeline
    assert.match(content, /Section 13/i, 'Must address Section 13 grievance redressal')
    assert.match(content, /privacy@collegecompanion\.edu/i, 'Must provide designated grievance contact email')
    assert.match(content, /30 days/i, 'Must specify statutory resolution timeline (30 days)')

    // 5. Academic purpose and FERPA record confidentiality
    assert.match(content, /FERPA/i, 'Must reference FERPA standards')
    assert.match(content, /Row-Level Security/i, 'Must reference Row-Level Security scoping')
  })

  it('verifies /privacy route is mounted in App.tsx', () => {
    const appPath = path.join(rootDir, 'src', 'App.tsx')
    const content = fs.readFileSync(appPath, 'utf8')

    assert.match(content, /import PrivacyPolicyPage/i, 'App.tsx must import PrivacyPolicyPage')
    assert.match(content, /<Route path="\/privacy" element={<PrivacyPolicyPage \/>}/i, 'App.tsx must define /privacy route')
  })

  it('verifies LoginPage surfaces DPDP consent notice and link for registration and login', () => {
    const loginPath = path.join(rootDir, 'src', 'pages', 'auth', 'LoginPage.tsx')
    const content = fs.readFileSync(loginPath, 'utf8')

    assert.match(content, /to="\/privacy"/i, 'LoginPage must link to /privacy')
    assert.match(content, /DPDP Act 2023/i, 'LoginPage must mention DPDP Act 2023')
    assert.match(content, /Institutional Data Protection/i, 'LoginPage must reference Institutional Data Protection Policy')
  })

  it('verifies AdminSettingsPage surfaces privacy governance link to /privacy', () => {
    const settingsPath = path.join(rootDir, 'src', 'pages', 'admin', 'AdminSettingsPage.tsx')
    const content = fs.readFileSync(settingsPath, 'utf8')

    assert.match(content, /to="\/privacy"/i, 'AdminSettingsPage must link to /privacy')
    assert.match(content, /DPDP Act 2023/i, 'AdminSettingsPage must mention DPDP Act 2023')
  })
})
