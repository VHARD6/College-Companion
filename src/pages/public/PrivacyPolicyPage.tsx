import { useNavigate } from 'react-router-dom'
import { Shield, ArrowLeft, Lock, FileText, UserCheck, Building, Mail } from 'lucide-react'
import Button from '../../components/ui/Button'

export default function PrivacyPolicyPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="text-blue-600 shrink-0" size={20} />
            <h1 className="text-base font-bold text-gray-900">Data Protection &amp; Privacy Notice</h1>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate('/login')}>
          Back to Login
        </Button>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-24">
        {/* Compliance Badge Card */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white rounded-2xl p-5 shadow-sm space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white">
            <Shield size={14} />
            <span>DPDP Act 2023 &amp; FERPA Aligned</span>
          </div>
          <h2 className="text-xl font-bold">Institutional Data Protection Policy</h2>
          <p className="text-xs sm:text-sm text-blue-100 leading-relaxed">
            College Companion is deployed as an institutional attendance and academic timetable management platform.
            This notice details our lawful processing of student and faculty data pursuant to the Indian Digital Personal
            Data Protection (DPDP) Act, 2023, FERPA standards, and international data protection principles.
          </p>
        </div>

        {/* Section 1: Data Fiduciary & Processor Roles */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-blue-600 font-semibold text-sm">
            <Building size={18} />
            <h3>1. Institutional Governance &amp; Fiduciary Roles</h3>
          </div>
          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            The respective <strong>Affiliated College or University</strong> acts as the primary <strong>Data Fiduciary</strong>{' '}
            determining the purposes and means of processing personal data. College Companion functions strictly as a{' '}
            <strong>Data Processor / Technical Intermediary</strong> operating under institutional authorization and
            strict role-based security boundaries.
          </p>
        </section>

        {/* Section 2: Data Collected */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-blue-600 font-semibold text-sm">
            <FileText size={18} />
            <h3>2. Categories of Personal Data Collected</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <span className="font-semibold text-gray-900 block mb-1">Student Data</span>
              <ul className="list-disc list-inside text-gray-600 space-y-1">
                <li>Full Name and Institutional Roll Number</li>
                <li>Institutional or Registered Email Address</li>
                <li>Department, Class Division &amp; Lab Batch</li>
                <li>Course Attendance Logs (Present/Absent status)</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <span className="font-semibold text-gray-900 block mb-1">Faculty &amp; Staff Data</span>
              <ul className="list-disc list-inside text-gray-600 space-y-1">
                <li>Full Name and Department Affiliation</li>
                <li>Official Faculty Email Address</li>
                <li>Teaching Assignment &amp; Timetable Allocations</li>
                <li>Session Submission &amp; Audit Trail Metadata</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 3: Lawful Purpose */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-blue-600 font-semibold text-sm">
            <Lock size={18} />
            <h3>3. Lawful Academic Purpose of Processing</h3>
          </div>
          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            Personal data is processed solely for legitimate educational and academic purposes, including:
          </p>
          <ul className="list-disc list-inside text-xs sm:text-sm text-gray-600 space-y-1.5 pl-1">
            <li>Tracking course completion and verifying attendance compliance against institutional thresholds (e.g. 75% rule).</li>
            <li>Publishing authoritative timetable slots, laboratory schedules, and classroom assignments.</li>
            <li>Generating official university attendance rosters and statutory accreditation documentation.</li>
            <li>Maintaining forensic audit trails of attendance corrections to prevent academic fraud.</li>
          </ul>
        </section>

        {/* Section 4: Minor Protection (DPDP Act Section 9) */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-amber-600 font-semibold text-sm">
            <UserCheck size={18} />
            <h3>4. First-Year Students Under 18 (DPDP Act Section 9)</h3>
          </div>
          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            In compliance with Section 9 of the DPDP Act 2023, students who matriculate before reaching 18 years of age
            are enrolled under institutional admission agreements verified by their lawful parents or legal guardians.
            The platform does not track student behavioral analytics, geolocation, or serve commercial advertisements to minors.
          </p>
        </section>

        {/* Section 5: Access Control & Security Boundaries */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-blue-600 font-semibold text-sm">
            <Shield size={18} />
            <h3>5. Scoped Access &amp; Forensic Immutability</h3>
          </div>
          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            Data access is strictly scoped via PostgreSQL Row-Level Security (RLS) policies:
          </p>
          <ul className="list-disc list-inside text-xs sm:text-sm text-gray-600 space-y-1.5 pl-1">
            <li><strong>Students:</strong> May inspect only their personal attendance percentages, lecture history, and enrolled timetable.</li>
            <li><strong>Professors:</strong> May mark and correct attendance only for sessions within their verified teaching assignments.</li>
            <li><strong>Audit Immutability:</strong> All attendance modifications after submission mandate a documented reason and are physically locked against deletion or modification by database trigger constraints.</li>
          </ul>
        </section>

        {/* Section 6: Grievance Redressal Officer */}
        <section className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-amber-800 font-semibold text-sm">
            <Mail size={18} />
            <h3>6. Data Protection Officer (DPO) &amp; Grievance Redressal (Section 13)</h3>
          </div>
          <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
            Pursuant to Section 13 of the Digital Personal Data Protection Act 2023, data subjects (students, guardians, and faculty)
            have the right to readily accessible grievance redressal. You may submit privacy inquiries, rectification requests,
            or data handling concerns directly to:
          </p>
          <div className="bg-white rounded-xl border border-amber-200 p-3.5 text-xs text-gray-700 space-y-1 font-mono">
            <p><span className="font-semibold text-gray-900">Designation:</span> Institutional Data Protection &amp; Grievance Redressal Cell</p>
            <p><span className="font-semibold text-gray-900">Email:</span> privacy@collegecompanion.edu</p>
            <p><span className="font-semibold text-gray-900">Statutory Resolution Timeline:</span> Acknowledgment within 48 hours; formal redressal within 30 days.</p>
          </div>
        </section>

        {/* Action button */}
        <div className="text-center pt-4">
          <Button size="lg" onClick={() => navigate(-1)} className="px-8">
            Return to Application
          </Button>
        </div>
      </main>
    </div>
  )
}
