"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/clientApi";

interface LeadRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  academic_year: string | null;
  status: "new" | "contacted" | "follow_up" | "converted" | "refused";
}

interface ClassRow {
  id: string;
  name: string;
}

interface SectionRow {
  id: string;
  name: string;
  classId: string;
  availableSeats: number;
}

interface ConvertResult {
  student_id: string;
  roll_number: string;
  login_email: string;
  login_password: string;
  warnings?: string[];
}

interface ConvertToStudentModalProps {
  open: boolean;
  lead: LeadRow | null;
  onClose: () => void;
  onConverted: () => Promise<void> | void;
}

export function ConvertToStudentModal({ open, lead, onClose, onConverted }: ConvertToStudentModalProps) {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [term, setTerm] = useState("Annual");
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear() + "-" + String((new Date().getFullYear() + 1) % 100).padStart(2, "0"));
  const [admissionFee, setAdmissionFee] = useState(20000);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);

  const filteredSections = useMemo(
    () => sections.filter((section) => section.classId === classId),
    [sections, classId],
  );

  useEffect(() => {
    if (!open || !lead) return;

    setError("");
    setWarning("");
    setResult(null);
    setEmail(lead.email ?? "");
    setAcademicYear(lead.academic_year ?? academicYear);

    const load = async () => {
      try {
        const [classData, sectionData] = await Promise.all([
          apiFetch<ClassRow[]>("/api/admin/classes"),
          apiFetch<SectionRow[]>("/api/admin/sections"),
        ]);
        setClasses(classData);
        setSections(sectionData);
        const initialClass = classData[0]?.id ?? "";
        setClassId(initialClass);
        const firstSection = sectionData.find((entry) => entry.classId === initialClass)?.id ?? "";
        setSectionId(firstSection);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load class/section options");
      }
    };

    void load();
  }, [open, lead]);

  useEffect(() => {
    if (!classId) {
      setSectionId("");
      return;
    }

    if (filteredSections.some((entry) => entry.id === sectionId)) return;
    setSectionId(filteredSections[0]?.id ?? "");
  }, [classId, filteredSections, sectionId]);

  if (!open || !lead) return null;

  const handleConvert = async (forceDuplicate = false) => {
    setLoading(true);
    setError("");
    setWarning("");

    try {
      const data = await apiFetch<ConvertResult>(`/api/admin/leads/${lead.id}/convert`, {
        method: "POST",
        body: JSON.stringify({
          class_id: classId,
          section_id: sectionId,
          term,
          academic_year: academicYear,
          admission_fee: admissionFee,
          email,
          forceDuplicate,
        }),
      });

      if (data.warnings && data.warnings.length > 0) {
        setWarning(data.warnings.join(" | "));
      }

      setResult(data);
      await onConverted();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to convert lead";
      if (message.toLowerCase().includes("continue anyway")) {
        const shouldContinue = window.confirm(`${message}\n\nClick OK to continue with conversion.`);
        if (shouldContinue) {
          await handleConvert(true);
          return;
        }
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const copyCredentials = async () => {
    if (!result) return;
    const text = `Login: ${result.login_email}\nPassword: ${result.login_password}`;
    await navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Convert Lead to Student</h2>
            <p className="text-sm text-slate-600">Admission creation with auto credentials</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700">Close</button>
        </div>

        {result ? (
          <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-lg font-semibold text-emerald-900">Student created</h3>
            <p className="text-sm text-emerald-800">Roll No: {result.roll_number}</p>
            <p className="text-sm text-emerald-800">Login: {result.login_email}</p>
            <p className="text-sm text-emerald-800">Password: {result.login_password}</p>
            {warning ? <p className="text-sm text-amber-700">Warning: {warning}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void copyCredentials()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Copy Credentials</button>
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Close</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Student Name</span>
                <input value={lead.name} disabled className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-slate-100" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Phone</span>
                <input value={lead.phone} disabled className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-slate-100" />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Email</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@email.com" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Class</span>
                <select value={classId} onChange={(event) => setClassId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
                  <option value="">Select class</option>
                  {classes.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Section</span>
                <select value={sectionId} onChange={(event) => setSectionId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
                  <option value="">Select section</option>
                  {filteredSections.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name} (Available: {entry.availableSeats})</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Term</span>
                <select value={term} onChange={(event) => setTerm(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="Term1">Term1</option>
                  <option value="Term2">Term2</option>
                  <option value="Annual">Annual</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Academic Year</span>
                <input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Admission Fee</span>
                <input type="number" min={0} value={admissionFee} onChange={(event) => setAdmissionFee(Number(event.target.value || 0))} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
            </div>

            {warning ? <p className="text-sm text-amber-700">{warning}</p> : null}
            {error ? <p className="text-sm text-rose-700">{error}</p> : null}

            <button
              onClick={() => void handleConvert(false)}
              disabled={loading || !classId || !sectionId}
              className="w-full rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Converting..." : "Confirm Admission"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
