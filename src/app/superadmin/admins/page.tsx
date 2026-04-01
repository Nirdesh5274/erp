"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface AdminRow {
  id: string;
  name: string;
  email: string;
  role: string;
  collegeName: string;
}

export default function SuperAdminAdminsPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch<AdminRow[]>("/api/superadmin/admins");
        setRows(data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load admins");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  if (loading && rows.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <SectionCard title="Admins" description="Admin management across all colleges">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((admin) => (
          <article key={admin.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-lg font-bold text-slate-800">{admin.name}</h3>
            <p className="mt-1 text-sm text-slate-600">Email: {admin.email}</p>
            <p className="text-sm text-slate-600">College: {admin.collegeName}</p>
            <p className="text-sm text-teal-700">Role: {admin.role}</p>
          </article>
        ))}
      </div>
    </SectionCard>
  );
}
