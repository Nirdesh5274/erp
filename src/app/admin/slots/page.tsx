"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface SlotRow {
  id: string;
  course: string;
  totalSeats: number;
  filledSeats: number;
  availableSeats: number;
  departmentId: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

export default function AdminSlotsPage() {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState("");

  const [course, setCourse] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [totalSeats, setTotalSeats] = useState(0);

  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [slotData, deptData] = await Promise.all([
        apiFetch<SlotRow[]>("/api/admin/slots"),
        apiFetch<DepartmentRow[]>("/api/admin/departments"),
      ]);
      setSlots(slotData);
      setDepartments(deptData);
      setDepartmentId((currentDepartmentId) => currentDepartmentId || deptData[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load slots");
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
      await apiFetch<SlotRow>("/api/admin/slots", {
        method: "POST",
        body: JSON.stringify({ departmentId, course, totalSeats }),
      });
      setCourse("");
      setTotalSeats(0);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create slot");
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Add Seat Slot" description="Set total and available seats by course">
        <form onSubmit={handleCreate} className="grid gap-3 text-sm md:grid-cols-3">
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" required>
            <option value="">Select department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
          <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Course (e.g. BCA)" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="number" min={0} value={totalSeats} onChange={(e) => setTotalSeats(Number(e.target.value))} placeholder="Total seats" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800">Add Slot</button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Slots" description="Seat mapping and live availability">
        <div className="grid gap-3 md:grid-cols-2">
          {slots.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-800">{item.course}</p>
              <p className="text-slate-600">Department: {deptById.get(item.departmentId) ?? "Unknown"}</p>
              <p className="text-teal-700">Filled: {item.filledSeats} / {item.totalSeats}</p>
              <p className="text-emerald-700">Available: {item.availableSeats}</p>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
