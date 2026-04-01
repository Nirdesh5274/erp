"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface DepartmentRow {
  id: string;
  name: string;
  created_at?: string;
}

export default function AdminDepartmentsPage() {
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<DepartmentRow[]>("/api/admin/departments");
      setDepartments(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load departments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredDepartments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return departments;
    return departments.filter((department) => department.name.toLowerCase().includes(query));
  }, [departments, search]);

  const createDepartment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const created = await apiFetch<DepartmentRow>("/api/admin/departments", {
        method: "POST",
        body: JSON.stringify({ name: normalizedName }),
      });

      setDepartments((prev) => [created, ...prev].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setSuccess(`Department created: ${created.name}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create department");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Create Department" description="Admins can create departments used across users, students, admissions, and slots.">
        <form onSubmit={createDepartment} className="grid gap-3 md:grid-cols-4">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Department name (e.g. Computer Science)"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
            required
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create Department"}
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}
      </SectionCard>

      <SectionCard title="Departments" description="Available to Admin, HOD, and Faculty workflows.">
        <div className="mb-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search department"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm md:max-w-md"
          />
        </div>

        {loading ? <p className="text-sm text-slate-600">Loading departments...</p> : null}

        {!loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredDepartments.map((department) => (
              <article key={department.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="font-semibold text-slate-900">{department.name}</p>
                <p className="text-xs text-slate-500">ID: {department.id}</p>
              </article>
            ))}
            {filteredDepartments.length === 0 ? <p className="text-xs text-slate-500">No departments found.</p> : null}
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
