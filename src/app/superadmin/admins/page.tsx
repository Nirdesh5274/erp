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
  isBlocked: boolean;
  lastLoginAt: string | null;
  usersCreated: number;
  hodCreated: number;
  estimatedMonthlyCharge: number;
}

export default function SuperAdminAdminsPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      setSuccess("");
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

  const reload = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<AdminRow[]>("/api/superadmin/admins");
      setRows(data);
    } finally {
      setLoading(false);
    }
  };

  const toggleBlock = async (admin: AdminRow) => {
    setError("");
    setSuccess("");
    try {
      await apiFetch("/api/superadmin/admins", {
        method: "PATCH",
        body: JSON.stringify({ adminId: admin.id, action: admin.isBlocked ? "unblock" : "block" }),
      });
      setSuccess(`Admin ${admin.isBlocked ? "unblocked" : "blocked"}`);
      await reload();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update admin status");
    }
  };

  const resetPassword = async (admin: AdminRow) => {
    setError("");
    setSuccess("");
    try {
      const result = await apiFetch<{ password: string }>("/api/superadmin/admins", {
        method: "PATCH",
        body: JSON.stringify({ adminId: admin.id, action: "resetPassword" }),
      });
      setSuccess(`New password for ${admin.email}: ${result.password}`);
      await reload();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to reset password");
    }
  };

  if (loading && rows.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <SectionCard title="Admins" description="Admin management across all colleges">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((admin) => (
          <article key={admin.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-lg font-bold text-slate-800">{admin.name}</h3>
            <p className="mt-1 text-sm text-slate-600">Email: {admin.email}</p>
            <p className="text-sm text-slate-600">College: {admin.collegeName}</p>
            <p className="text-sm text-teal-700">Role: {admin.role}</p>
            <p className="text-sm text-slate-600">Last Login: {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}</p>
            <p className="text-sm text-slate-600">Users Created: {admin.usersCreated}</p>
            <p className="text-sm text-slate-600">HOD Created: {admin.hodCreated}</p>
            <p className="text-sm font-semibold text-slate-800">Est. Charge: INR {admin.estimatedMonthlyCharge.toLocaleString()}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void resetPassword(admin)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Reset Password</button>
              <button onClick={() => void toggleBlock(admin)} className={`rounded-md border px-2 py-1 text-xs ${admin.isBlocked ? "border-emerald-300 text-emerald-700" : "border-rose-300 text-rose-700"}`}>
                {admin.isBlocked ? "Unblock" : "Block"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </SectionCard>
  );
}
