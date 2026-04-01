"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton, TableSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "HOD" | "Faculty" | "Student";
  department_id: string | null;
}

interface DepartmentRow {
  id: string;
  name: string;
}

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"HOD" | "Faculty">("HOD");
  const [departmentId, setDepartmentId] = useState("");

  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [userData, departmentData] = await Promise.all([
        apiFetch<UserRow[]>("/api/admin/users"),
        apiFetch<DepartmentRow[]>("/api/admin/departments"),
      ]);
      setRows(userData);
      setDepartments(departmentData);
      setDepartmentId((current) => current || departmentData[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load user management data");
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

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) return;

    setError("");
    try {
      await apiFetch<UserRow>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password: password.trim(),
          role,
          departmentId: departmentId || null,
        }),
      });
      setName("");
      setEmail("");
      setPassword("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create user");
    }
  };

  const hodRows = rows.filter((item) => item.role === "HOD");
  const facultyRows = rows.filter((item) => item.role === "Faculty");

  if (loading && rows.length === 0 && departments.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Create HOD / Faculty" description="Admin can onboard HOD and Faculty">
        <form onSubmit={handleCreate} className="grid gap-3 text-sm md:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="rounded-xl border border-slate-300 px-3 py-2"
            required
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="rounded-xl border border-slate-300 px-3 py-2"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Temporary password"
            className="rounded-xl border border-slate-300 px-3 py-2"
            required
          />
          <select value={role} onChange={(e) => setRole(e.target.value as "HOD" | "Faculty")} className="rounded-xl border border-slate-300 px-3 py-2">
            <option value="HOD">HOD</option>
            <option value="Faculty">Faculty</option>
          </select>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 md:col-span-2" required>
            <option value="">Select department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
          <button type="submit" className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white md:col-span-2">
            Create User
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="HOD List" description="Department heads in this college">
          {loading ? <TableSkeleton rows={4} /> : null}
          <div className="space-y-2 text-sm">
            {hodRows.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-semibold text-slate-800">{item.name}</p>
                <p className="text-slate-600">{item.email}</p>
                <p className="text-teal-700">Department: {item.department_id ? deptById.get(item.department_id) ?? "Unknown" : "—"}</p>
              </div>
            ))}
            {hodRows.length === 0 && !loading ? <p className="text-xs text-slate-600">No HODs yet.</p> : null}
          </div>
        </SectionCard>

        <SectionCard title="Faculty List" description="Teaching staff in this college">
          {loading ? <TableSkeleton rows={4} /> : null}
          <div className="space-y-2 text-sm">
            {facultyRows.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-semibold text-slate-800">{item.name}</p>
                <p className="text-slate-600">{item.email}</p>
                <p className="text-teal-700">Department: {item.department_id ? deptById.get(item.department_id) ?? "Unknown" : "—"}</p>
              </div>
            ))}
            {facultyRows.length === 0 && !loading ? <p className="text-xs text-slate-600">No faculty yet.</p> : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
