"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface StudentRow {
  id: string;
  name: string;
  email: string;
  department_id: string;
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

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [error, setError] = useState("");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");

  const [departmentId, setDepartmentId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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

  const createStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    try {
      const created = await apiFetch<AdmissionCreateResponse>("/api/admin/admissions", {
        method: "POST",
        body: JSON.stringify({
          departmentId,
          slotId,
          studentName,
          email,
          phone: phone || null,
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
              pattern="\\d{10}"
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
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white md:col-span-3">Add Student</button>
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
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
