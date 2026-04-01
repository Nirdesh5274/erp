"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface StudentRow {
  id: string;
  name: string;
  email: string;
  department_id: string;
  current_semester?: number | null;
  created_at: string;
  temp_password?: string | null;
  must_change_password?: boolean | null;
  password_generated_at?: string | null;
}

interface DepartmentRow {
  id: string;
  name: string;
}

interface SlotRow {
  id: string;
  course: string;
  availableSeats: number;
  departmentId: string;
}

interface AdmissionCreateResponse {
  studentCredentials?: {
    email: string;
    tempPassword: string;
    mustChangePassword: boolean;
  } | null;
}

interface SemesterUpgradeResponse {
  studentId: string;
  previousSemester: number;
  currentSemester: number;
  feeStructureId?: string;
  feeGenerated?: boolean;
  generatedFeeId?: string | null;
  upgradedAt: string;
}

interface BulkSemesterUpgradeResponse {
  slotId: string;
  fromSemester: number;
  targetSemester: number;
  totalCandidates: number;
  upgradedCount: number;
  skippedCount: number;
  results: Array<{
    studentId: string;
    name: string;
    upgraded: boolean;
    message: string;
  }>;
}

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [error, setError] = useState("");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [upgradingId, setUpgradingId] = useState<string | null>(null);
  const [bulkUpgrading, setBulkUpgrading] = useState(false);
  const [success, setSuccess] = useState("");

  const [departmentId, setDepartmentId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentSemester, setCurrentSemester] = useState(1);
  const [feeAmount, setFeeAmount] = useState(20000);

  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
  const filteredSlots = useMemo(() => slots.filter((slot) => slot.departmentId === departmentId), [slots, departmentId]);

  const load = async () => {
    setError("");
    try {
      const [studentData, departmentData, slotData] = await Promise.all([
        apiFetch<StudentRow[]>("/api/admin/students"),
        apiFetch<DepartmentRow[]>("/api/admin/departments"),
        apiFetch<SlotRow[]>("/api/admin/slots"),
      ]);
      setStudents(studentData);
      setDepartments(departmentData);
      setSlots(slotData);

      setDepartmentId((current) => {
        const nextDepartmentId = current || departmentData[0]?.id || "";
        setSlotId((currentSlot) => {
          const matching = slotData.filter((slot) => slot.departmentId === nextDepartmentId);
          if (matching.some((slot) => slot.id === currentSlot)) return currentSlot;
          return matching[0]?.id ?? "";
        });
        return nextDepartmentId;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load students");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const regeneratePassword = async (studentId: string) => {
    setRegeneratingId(studentId);
    setError("");
    setSuccess("");
    try {
      const data = await apiFetch<{ email: string; tempPassword: string }>("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({ studentId }),
      });
      setSuccess(`New temp password generated for ${data.email}: ${data.tempPassword}`);
      await load();
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : "Unable to regenerate password");
    } finally {
      setRegeneratingId(null);
    }
  };

  const upgradeSemester = async (student: StudentRow) => {
    const currentSemester = Number(student.current_semester ?? 1);
    const targetSemester = currentSemester + 1;

    if (targetSemester > 12) {
      setError("Student is already in final semester");
      return;
    }

    setUpgradingId(student.id);
    setError("");
    setSuccess("");

    try {
      const data = await apiFetch<SemesterUpgradeResponse>("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({
          studentId: student.id,
          action: "upgradeSemester",
          targetSemester,
        }),
      });

      setSuccess(
        `Semester upgraded: ${student.name} (${data.previousSemester} -> ${data.currentSemester})${data.feeGenerated ? " | New semester fee generated" : " | Semester fee already exists"}`,
      );
      await load();
    } catch (upgradeError) {
      setError(upgradeError instanceof Error ? upgradeError.message : "Unable to upgrade semester");
    } finally {
      setUpgradingId(null);
    }
  };

  const bulkUpgradeSemester = async () => {
    if (!slotId) {
      setError("Select a slot before bulk promotion");
      return;
    }

    const targetSemester = currentSemester + 1;
    if (targetSemester > 12) {
      setError("Target semester cannot be greater than 12");
      return;
    }

    setBulkUpgrading(true);
    setError("");
    setSuccess("");

    try {
      const data = await apiFetch<BulkSemesterUpgradeResponse>("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({
          action: "bulkUpgradeSemester",
          slotId,
          fromSemester: currentSemester,
          targetSemester,
        }),
      });

      const failed = data.results.filter((row) => !row.upgraded);
      const firstFailure = failed[0];

      setSuccess(
        `Bulk promotion completed: ${data.upgradedCount}/${data.totalCandidates} upgraded (Sem ${data.fromSemester} -> ${data.targetSemester})${firstFailure ? ` | First skip: ${firstFailure.name} (${firstFailure.message})` : ""}`,
      );

      await load();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Unable to bulk upgrade semester");
    } finally {
      setBulkUpgrading(false);
    }
  };

  const createStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (phone && phone.length !== 10) {
      setError("Phone number must be exactly 10 digits");
      return;
    }

    try {
      const created = await apiFetch<AdmissionCreateResponse>("/api/admin/admissions", {
        method: "POST",
        body: JSON.stringify({
          departmentId,
          slotId,
          studentName,
          email,
          phone: phone || null,
          currentSemester,
          feeAmount,
        }),
      });

      setStudentName("");
      setEmail("");
      setPhone("");

      if (created.studentCredentials) {
        setSuccess(
          `Student added. Email: ${created.studentCredentials.email} | Temp Password: ${created.studentCredentials.tempPassword}`,
        );
      } else {
        setSuccess("Student added successfully");
      }

      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create student");
    }
  };

  const handlePhoneChange = (value: string) => {
    setPhone(value.replace(/\D/g, "").slice(0, 10));
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Add Student" description="Admin admission flow with auto-generated login credentials">
        <form onSubmit={createStudent} className="grid gap-3 text-sm md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Department</span>
            <select
              value={departmentId}
              onChange={(e) => {
                const nextDepartmentId = e.target.value;
                setDepartmentId(nextDepartmentId);
                const firstSlot = slots.find((slot) => slot.departmentId === nextDepartmentId);
                setSlotId(firstSlot?.id ?? "");
              }}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            >
              <option value="">Select department</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Slot / Course</span>
            <select
              value={slotId}
              onChange={(e) => setSlotId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            >
              <option value="">Select slot</option>
              {filteredSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>{slot.course} (Available: {slot.availableSeats})</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Student Name</span>
            <input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Student full name" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Student Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@example.com" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Phone Number</span>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="10-digit mobile number"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Admission Fee</span>
            <input type="number" min={0} value={feeAmount} onChange={(e) => setFeeAmount(Number(e.target.value))} placeholder="Admission fee amount" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Current Semester</span>
            <select
              value={currentSemester}
              onChange={(e) => setCurrentSemester(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            >
              {Array.from({ length: 12 }, (_, index) => {
                const semester = index + 1;
                return (
                  <option key={semester} value={semester}>
                    Semester {semester}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 md:col-span-3">
            <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white">Add Student</button>
            <button
              type="button"
              onClick={() => void bulkUpgradeSemester()}
              disabled={bulkUpgrading || !slotId}
              className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {bulkUpgrading ? "Promoting..." : `Promote Slot Sem ${currentSemester} -> ${Math.min(currentSemester + 1, 12)}`}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Students" description="Live student registry">
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {students.map((student) => (
            <article key={student.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-800">{student.name}</p>
              <p className="text-slate-600">{student.email}</p>
              <p className="text-teal-700">{deptById.get(student.department_id) ?? "Unknown"}</p>
              <p className="text-slate-600">Semester: {student.current_semester ?? "N/A"}</p>
              <p className="text-xs text-slate-500">Joined: {new Date(student.created_at).toLocaleDateString()}</p>
              <p className="mt-1 text-xs text-slate-700">
                Temp Password: {student.temp_password || "Not generated"}
              </p>
              {student.must_change_password ? (
                <p className="text-xs text-amber-700">Student must change password on next login</p>
              ) : (
                <p className="text-xs text-emerald-700">Password already changed</p>
              )}
              <button
                onClick={() => void regeneratePassword(student.id)}
                disabled={regeneratingId === student.id}
                className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {regeneratingId === student.id ? "Generating..." : "Generate New Password"}
              </button>
              <button
                onClick={() => void upgradeSemester(student)}
                disabled={upgradingId === student.id || Number(student.current_semester ?? 1) >= 12}
                className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {upgradingId === student.id
                  ? "Upgrading..."
                  : Number(student.current_semester ?? 1) >= 12
                    ? "Final Semester"
                    : "Promote to Next Semester"}
              </button>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
