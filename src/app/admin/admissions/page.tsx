"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface AdmissionRow {
  id: string;
  studentName: string;
  email: string;
  phone: string | null;
  status: string;
  createdAt: string;
  departmentId: string;
  slotId: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

interface SlotRow {
  id: string;
  course: string;
  totalSeats: number;
  filledSeats: number;
  availableSeats: number;
  departmentId: string;
}

export default function AdminAdmissionsPage() {
  const [rows, setRows] = useState<AdmissionRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [error, setError] = useState("");

  const [departmentId, setDepartmentId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feeAmount, setFeeAmount] = useState(20000);

  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
  const filteredSlots = slots.filter((slot) => slot.departmentId === departmentId);

  const load = useCallback(async () => {
    setError("");
    try {
      const [admissionData, departmentData, slotData] = await Promise.all([
        apiFetch<AdmissionRow[]>("/api/admin/admissions"),
        apiFetch<DepartmentRow[]>("/api/admin/departments"),
        apiFetch<SlotRow[]>("/api/admin/slots"),
      ]);
      setRows(admissionData);
      setDepartments(departmentData);
      setSlots(slotData);

      setDepartmentId((currentDepartmentId) => {
        const nextDepartmentId = currentDepartmentId || departmentData[0]?.id || "";

        setSlotId((currentSlotId) => {
          const matchingSlots = slotData.filter((slot) => slot.departmentId === nextDepartmentId);
          if (matchingSlots.some((slot) => slot.id === currentSlotId)) return currentSlotId;
          return matchingSlots[0]?.id ?? "";
        });

        return nextDepartmentId;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load admissions");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      await apiFetch<{ admission_id: string }>("/api/admin/admissions", {
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
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create admission");
    }
  };

  const handlePhoneChange = (value: string) => {
    setPhone(value.replace(/\D/g, "").slice(0, 10));
  };

  return (
    <div className="space-y-6">
      <SectionCard title="New Admission" description="Auto flow: slot check -> admission -> fee -> student -> seat update">
        <form onSubmit={handleCreate} className="grid gap-3 text-sm md:grid-cols-3">
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
            <select value={slotId} onChange={(e) => setSlotId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
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
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 md:col-span-3">Submit Admission</button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Admissions" description="Recent admission pipeline">
        <div className="space-y-3">
          {rows.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-800">{item.studentName}</p>
              <p className="text-slate-600">{item.email}</p>
              <p className="text-slate-600">Department: {deptById.get(item.departmentId) ?? "Unknown"}</p>
              <p className="text-teal-700">{item.status} • {new Date(item.createdAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
