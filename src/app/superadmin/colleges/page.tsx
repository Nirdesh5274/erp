"use client";

import { FormEvent, useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton, TableSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface CollegeRow {
  id: string;
  name: string;
  location: string;
  created_at: string;
}

interface CreateCollegePayload {
  name: string;
  location: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export default function SuperAdminCollegesPage() {
  const [rows, setRows] = useState<CollegeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<CollegeRow[]>("/api/superadmin/colleges");
      setRows(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load colleges");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const payload: CreateCollegePayload = { name, location, adminName, adminEmail, adminPassword };
      await apiFetch<{ id: string }>("/api/superadmin/colleges", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setName("");
      setLocation("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create college");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && rows.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Create College + Admin" description="Onboard new colleges and seed admin credentials">
        <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-2 text-sm">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="College name" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Admin name" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Admin email" type="email" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Admin password" type="password" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <button disabled={submitting} className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-70">
            {submitting ? "Creating..." : "Create College"}
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Colleges" description="All onboarded colleges">
        {loading ? <TableSkeleton rows={4} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">College</th>
                <th className="py-2">Location</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((college) => (
                <tr key={college.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-2 font-semibold">{college.name}</td>
                  <td className="py-2">{college.location}</td>
                  <td className="py-2">{new Date(college.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
