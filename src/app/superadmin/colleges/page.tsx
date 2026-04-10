"use client";

import { FormEvent, useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton, TableSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface CollegeRow {
  id: string;
  name: string;
  location: string;
  type?: "college" | "school";
  institution_code?: string | null;
  status?: "Active" | "Pending" | "Suspended";
  logo_url?: string | null;
  created_at: string;
}

interface CreateCollegePayload {
  name: string;
  location: string;
  type: "college" | "school";
  institutionCode?: string;
  status?: "Active" | "Pending" | "Suspended";
  logoUrl?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export default function SuperAdminCollegesPage() {
  const [rows, setRows] = useState<CollegeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState<CollegeRow | null>(null);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState<"college" | "school">("college");
  const [institutionCode, setInstitutionCode] = useState("");
  const [status, setStatus] = useState<"Active" | "Pending" | "Suspended">("Pending");
  const [logoUrl, setLogoUrl] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
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
    setSuccess("");
    try {
      const payload: CreateCollegePayload = { name, location, type, institutionCode, status, logoUrl, adminName, adminEmail, adminPassword };
      await apiFetch<{ id: string }>("/api/superadmin/colleges", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setName("");
      setLocation("");
      setType("college");
      setInstitutionCode("");
      setStatus("Pending");
      setLogoUrl("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      setSuccess("Institution created successfully");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create college");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this institution? All mapped data may be removed.")) return;
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/api/superadmin/colleges/${id}`, { method: "DELETE" });
      setSuccess("Institution deleted");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete institution");
    }
  };

  const handleStatusToggle = async (college: CollegeRow) => {
    const nextStatus: "Active" | "Pending" | "Suspended" = college.status === "Active" ? "Suspended" : "Active";
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/api/superadmin/colleges/${college.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      setSuccess(`Status updated to ${nextStatus}`);
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update status");
    }
  };

  const handleEditSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/api/superadmin/colleges/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editing.name,
          location: editing.location,
          type: editing.type,
          institutionCode: editing.institution_code ?? null,
          status: editing.status ?? "Pending",
          logoUrl: editing.logo_url ?? null,
        }),
      });
      setEditing(null);
      setSuccess("Institution updated");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update institution");
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
          <select value={type} onChange={(e) => setType((e.target.value as "college" | "school") ?? "college")} className="rounded-xl border border-slate-300 px-3 py-2" required>
            <option value="college">College / University</option>
            <option value="school">School (Class 1-12)</option>
          </select>
          <input value={institutionCode} onChange={(e) => setInstitutionCode(e.target.value)} placeholder="College/School ID" className="rounded-xl border border-slate-300 px-3 py-2" />
          <select value={status} onChange={(e) => setStatus((e.target.value as "Active" | "Pending" | "Suspended") ?? "Pending")} className="rounded-xl border border-slate-300 px-3 py-2">
            <option value="Pending">Pending</option>
            <option value="Active">Active</option>
            <option value="Suspended">Suspended</option>
          </select>
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="Logo URL (optional)" className="rounded-xl border border-slate-300 px-3 py-2" />
          <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Admin name" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Admin email" type="email" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Admin password" type="password" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <button disabled={submitting} className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-70">
            {submitting ? "Creating..." : "Create College"}
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}
      </SectionCard>

      <SectionCard title="Colleges" description="All onboarded colleges">
        {loading ? <TableSkeleton rows={4} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">College</th>
                <th className="py-2">Code</th>
                <th className="py-2">Location</th>
                <th className="py-2">Type</th>
                <th className="py-2">Status</th>
                <th className="py-2">Created</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((college) => (
                <tr key={college.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-2 font-semibold">{college.name}</td>
                  <td className="py-2">{college.institution_code ?? "-"}</td>
                  <td className="py-2">{college.location}</td>
                  <td className="py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${college.type === "school" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                      {college.type === "school" ? "SCHOOL" : "COLLEGE"}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${college.status === "Active" ? "bg-emerald-100 text-emerald-700" : college.status === "Suspended" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                      {college.status ?? "Pending"}
                    </span>
                  </td>
                  <td className="py-2">{new Date(college.created_at).toLocaleString()}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setEditing(college)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Edit</button>
                      <button onClick={() => void handleStatusToggle(college)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">{college.status === "Active" ? "Suspend" : "Activate"}</button>
                      <button onClick={() => void handleDelete(college.id)} className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {editing ? (
        <SectionCard title="Edit Institution" description="Update institution details and status">
          <form onSubmit={handleEditSave} className="grid gap-3 md:grid-cols-2 text-sm">
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="rounded-xl border border-slate-300 px-3 py-2" required />
            <input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} className="rounded-xl border border-slate-300 px-3 py-2" required />
            <select value={editing.type ?? "college"} onChange={(e) => setEditing({ ...editing, type: (e.target.value as "college" | "school") ?? "college" })} className="rounded-xl border border-slate-300 px-3 py-2">
              <option value="college">College</option>
              <option value="school">School</option>
            </select>
            <input value={editing.institution_code ?? ""} onChange={(e) => setEditing({ ...editing, institution_code: e.target.value })} placeholder="College/School ID" className="rounded-xl border border-slate-300 px-3 py-2" />
            <select value={editing.status ?? "Pending"} onChange={(e) => setEditing({ ...editing, status: (e.target.value as "Active" | "Pending" | "Suspended") ?? "Pending" })} className="rounded-xl border border-slate-300 px-3 py-2">
              <option value="Pending">Pending</option>
              <option value="Active">Active</option>
              <option value="Suspended">Suspended</option>
            </select>
            <input value={editing.logo_url ?? ""} onChange={(e) => setEditing({ ...editing, logo_url: e.target.value })} placeholder="Logo URL" className="rounded-xl border border-slate-300 px-3 py-2" />
            <div className="flex gap-2 md:col-span-2">
              <button disabled={submitting} className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-70">{submitting ? "Saving..." : "Save"}</button>
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">Cancel</button>
            </div>
          </form>
        </SectionCard>
      ) : null}
    </div>
  );
}
