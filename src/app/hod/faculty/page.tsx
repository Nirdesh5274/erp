"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface FacultyRow {
  id: string;
  name: string;
  email: string;
  department_id: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

export default function HodFacultyPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [subject, setSubject] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [items, setItems] = useState<FacultyRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [facultyData, departmentData] = await Promise.all([
        apiFetch<FacultyRow[]>("/api/hod/faculty"),
        apiFetch<DepartmentRow[]>("/api/admin/departments"),
      ]);
      setItems(facultyData);
      setDepartments(departmentData);
      setDepartmentId((currentDepartmentId) => currentDepartmentId || departmentData[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load faculty");
    } finally {
      setLoading(false);
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

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !subject.trim() || !email.trim() || !password.trim() || !departmentId) return;

    setError("");
    try {
      await apiFetch<FacultyRow>("/api/hod/faculty", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password: password.trim(),
          departmentId,
          subjectName: subject.trim(),
        }),
      });
      setName("");
      setEmail("");
      setPassword("");
      setSubject("");
      await load();
      toast.success("Faculty created");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to create faculty";
      setError(message);
      toast.error(message);
    }
  };

  if (loading && items.length === 0 && departments.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Add Faculty" description="Create faculty and assign initial subject">
        <form onSubmit={handleAdd} className="space-y-3 text-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Faculty name"
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Faculty email"
            type="email"
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Temporary password"
            type="password"
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
          />
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
          >
            <option value="">Select department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Assign subject"
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
          />
          <button type="submit" className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white">
            Add Faculty
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Faculty List" description="Department faculty registry">
        <div className="space-y-2 text-sm">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="font-semibold text-slate-800">{item.name}</p>
              <p className="text-slate-600">{item.email}</p>
              <p className="text-teal-700">Department: {deptById.get(item.department_id) ?? "Unknown"}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
