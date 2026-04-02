"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConvertToStudentModal } from "@/components/admin/ConvertToStudentModal";
import { SectionCard } from "@/components/ui/SectionCard";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { apiFetch } from "@/lib/clientApi";

type LeadStatus = "new" | "contacted" | "follow_up" | "converted" | "refused";

interface LeadRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  interested_class: string | null;
  interested_section: string | null;
  academic_year: string | null;
  status: LeadStatus;
  refused_reason: string | null;
  follow_up_date: string | null;
  notes: string | null;
  assigned_to: string | null;
  converted_student_id: string | null;
  converted_at: string | null;
  source: "walk_in" | "phone" | "online" | "referral" | "other" | null;
  created_at: string;
  updated_at: string;
}

interface LeadsResponse {
  leads: LeadRow[];
  counts: {
    new: number;
    contacted: number;
    follow_up: number;
    converted: number;
    refused: number;
    total: number;
  };
  page: number;
  limit: number;
  totalPages: number;
}

interface ClassRow {
  id: string;
  name: string;
}

interface CollegeAdmissionRow {
  id: string;
  studentName: string;
  email: string;
  status: string;
  createdAt: string;
  departmentId: string | null;
  currentSemester?: number | null;
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

function statusBadge(status: LeadStatus) {
  if (status === "new") return "bg-slate-200 text-slate-700";
  if (status === "contacted") return "bg-blue-100 text-blue-700";
  if (status === "follow_up") return "bg-amber-100 text-amber-700";
  if (status === "converted") return "bg-emerald-100 text-emerald-700";
  return "bg-rose-100 text-rose-700";
}

function statusLabel(status: LeadStatus) {
  if (status === "follow_up") return "Follow-up";
  return status[0].toUpperCase() + status.slice(1);
}

const statusOptions: Record<LeadStatus, Array<{ value: LeadStatus; label: string }>> = {
  new: [
    { value: "contacted", label: "Mark Contacted" },
    { value: "refused", label: "Mark Refused" },
  ],
  contacted: [
    { value: "follow_up", label: "Set Follow-up" },
    { value: "refused", label: "Mark Refused" },
  ],
  follow_up: [
    { value: "contacted", label: "Mark Contacted" },
    { value: "refused", label: "Mark Refused" },
  ],
  converted: [],
  refused: [],
};

export default function AdminAdmissionsPage() {
  const { isSchool } = useInstitutionType();
  if (!isSchool) return <CollegeAdmissionsFallback />;
  return <SchoolLeadsPipeline />;
}

function SchoolLeadsPipeline() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [counts, setCounts] = useState<LeadsResponse["counts"]>({
    new: 0,
    contacted: 0,
    follow_up: 0,
    converted: 0,
    refused: 0,
    total: 0,
  });
  const [statusTab, setStatusTab] = useState<"all" | LeadStatus>("all");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showDrawer, setShowDrawer] = useState(false);
  const [activeLead, setActiveLead] = useState<LeadRow | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [interestedClass, setInterestedClass] = useState("");
  const [source, setSource] = useState<"walk_in" | "phone" | "online" | "referral" | "other">("walk_in");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const classMap = useMemo(() => new Map(classes.map((entry) => [entry.id, entry.name])), [classes]);
  const pipelineCount = counts.new + counts.contacted + counts.follow_up;
  const conversionRate = counts.total > 0 ? ((counts.converted / counts.total) * 100).toFixed(1) : "0.0";

  const loadLeads = useCallback(async () => {
    setError("");
    try {
      const query = new URLSearchParams();
      if (statusTab !== "all") query.set("status", statusTab);
      if (classFilter) query.set("class", classFilter);
      if (yearFilter) query.set("academic_year", yearFilter);
      if (search.trim()) query.set("search", search.trim());
      query.set("page", String(page));
      query.set("limit", String(limit));

      const data = await apiFetch<LeadsResponse>(`/api/admin/leads?${query.toString()}`);
      setLeads(data.leads);
      setCounts(data.counts);
      setTotalPages(data.totalPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load leads");
    }
  }, [statusTab, classFilter, yearFilter, search, page, limit]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    const loadClasses = async () => {
      try {
        const data = await apiFetch<ClassRow[]>("/api/admin/classes");
        setClasses(data);
      } catch {
        setClasses([]);
      }
    };
    void loadClasses();
  }, []);

  const refreshAfterMutation = async () => {
    setSuccess("Updated successfully");
    await loadLeads();
  };

  const updateLeadStatus = async (lead: LeadRow, nextStatus: LeadStatus) => {
    setError("");
    setSuccess("");

    const payload: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "follow_up") {
      const followUpDate = window.prompt("Enter follow-up date (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
      if (!followUpDate) return;
      payload.followUpDate = followUpDate;
    }

    if (nextStatus === "refused") {
      const reason = window.prompt("Enter refused reason", lead.refused_reason ?? "Not interested");
      payload.refusedReason = reason ?? "Not specified";
    }

    try {
      await apiFetch(`/api/admin/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await refreshAfterMutation();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update lead");
    }
  };

  const handleSoftDelete = async (lead: LeadRow) => {
    if (!(lead.status === "new" || lead.status === "refused")) return;
    const confirmed = window.confirm("Delete this enquiry?");
    if (!confirmed) return;

    try {
      await apiFetch(`/api/admin/leads/${lead.id}`, { method: "DELETE" });
      await refreshAfterMutation();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete lead");
    }
  };

  const createLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          phone,
          email,
          parentName,
          parentPhone,
          interestedClass,
          source,
          notes,
          academicYear: yearFilter || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        if (payload?.error?.message === "DUPLICATE_LEAD") {
          const existing = payload?.existing;
          throw new Error(`DUPLICATE_LEAD: ${existing?.name ?? "Existing lead"} (${existing?.status ?? "active"})`);
        }
        throw new Error(payload?.error?.message ?? "Unable to create lead");
      }

      setName("");
      setPhone("");
      setEmail("");
      setParentName("");
      setParentPhone("");
      setInterestedClass("");
      setSource("walk_in");
      setNotes("");
      setShowDrawer(false);
      setSuccess("Enquiry created successfully");
      await loadLeads();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create lead");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Enquiries / Admissions Pipeline" description="Track and convert every interested lead">
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-2xl font-semibold text-slate-900">{counts.total}</p>
            <p className="text-xs text-slate-600">Total Enquiries</p>
          </article>
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-2xl font-semibold text-emerald-900">{counts.converted}</p>
            <p className="text-xs text-emerald-700">Converted Students</p>
          </article>
          <article className="rounded-xl border border-blue-200 bg-blue-50 p-3">
            <p className="text-2xl font-semibold text-blue-900">{pipelineCount}</p>
            <p className="text-xs text-blue-700">Pipeline Active</p>
          </article>
          <article className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="text-2xl font-semibold text-rose-900">{counts.refused}</p>
            <p className="text-xs text-rose-700">Lost</p>
          </article>
        </div>

        <p className="mb-4 text-sm text-slate-600">Conversion rate: {conversionRate}%</p>

        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={() => { setStatusTab("all"); setPage(1); }} className={`rounded-full px-3 py-1 text-sm ${statusTab === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>All</button>
          <button onClick={() => { setStatusTab("new"); setPage(1); }} className={`rounded-full px-3 py-1 text-sm ${statusTab === "new" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>New {counts.new}</button>
          <button onClick={() => { setStatusTab("contacted"); setPage(1); }} className={`rounded-full px-3 py-1 text-sm ${statusTab === "contacted" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Contacted {counts.contacted}</button>
          <button onClick={() => { setStatusTab("follow_up"); setPage(1); }} className={`rounded-full px-3 py-1 text-sm ${statusTab === "follow_up" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Follow-up {counts.follow_up}</button>
          <button onClick={() => { setStatusTab("refused"); setPage(1); }} className={`rounded-full px-3 py-1 text-sm ${statusTab === "refused" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Refused {counts.refused}</button>
          <button onClick={() => { setStatusTab("converted"); setPage(1); }} className={`rounded-full px-3 py-1 text-sm ${statusTab === "converted" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Converted {counts.converted}</button>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search by name or phone"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setPage(1); }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All classes</option>
            {classes.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
          <input value={yearFilter} onChange={(event) => { setYearFilter(event.target.value); setPage(1); }} placeholder="Academic year (2025-26)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button onClick={() => setShowDrawer(true)} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">+ New Enquiry</button>
        </div>

        {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}

        <div className="space-y-3">
          {leads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              No enquiries yet. Click + New Enquiry to add your first lead.
            </p>
          ) : (
            leads.map((lead) => (
              <article key={lead.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-semibold text-slate-900">{lead.name}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadge(lead.status)}`}>{statusLabel(lead.status)}</span>
                </div>
                <p className="text-slate-600">
                  {lead.phone} • {lead.interested_class ? `${classMap.get(lead.interested_class) ?? lead.interested_class} interest` : "General enquiry"}
                </p>
                <p className="text-slate-500">Added: {new Date(lead.created_at).toLocaleDateString()} • {lead.source ?? "other"}</p>
                {lead.notes ? <p className="mt-2 text-slate-700">Notes: {lead.notes}</p> : null}
                {lead.status === "refused" && lead.refused_reason ? <p className="mt-2 text-rose-700">Reason: {lead.refused_reason}</p> : null}
                {lead.status === "converted" && lead.converted_student_id ? <p className="mt-2 text-emerald-700">Converted student: {lead.converted_student_id}</p> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {statusOptions[lead.status].length > 0 ? (
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        const next = event.target.value as LeadStatus;
                        if (!next) return;
                        void updateLeadStatus(lead, next);
                        event.currentTarget.value = "";
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    >
                      <option value="">Update Status</option>
                      {statusOptions[lead.status].map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                      ))}
                    </select>
                  ) : null}

                  <button
                    onClick={() => setActiveLead(lead)}
                    disabled={lead.status === "refused" || lead.status === "converted"}
                    className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Convert to Student
                  </button>

                  {(lead.status === "new" || lead.status === "refused") ? (
                    <button onClick={() => void handleSoftDelete(lead)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Delete</button>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-slate-600">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-60">Prev</button>
            <button onClick={() => setPage((current) => Math.min(current + 1, totalPages))} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-60">Next</button>
          </div>
        </div>
      </SectionCard>

      <ConvertToStudentModal
        open={Boolean(activeLead)}
        lead={activeLead}
        onClose={() => setActiveLead(null)}
        onConverted={async () => {
          setActiveLead(null);
          await refreshAfterMutation();
        }}
      />

      {showDrawer ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40">
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">New Enquiry</h2>
              <button onClick={() => setShowDrawer(false)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm">Close</button>
            </div>

            <form onSubmit={(event) => void createLead(event)} className="space-y-3 text-sm">
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Name *</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Phone *</span>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Parent Name</span>
                <input value={parentName} onChange={(event) => setParentName(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Parent Phone</span>
                <input value={parentPhone} onChange={(event) => setParentPhone(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Interested Class</span>
                <select value={interestedClass} onChange={(event) => setInterestedClass(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="">Select class</option>
                  {classes.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Source</span>
                <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="walk_in">Walk-in</option>
                  <option value="phone">Phone</option>
                  <option value="online">Online</option>
                  <option value="referral">Referral</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-slate-600">Notes</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <button type="submit" disabled={creating} className="w-full rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60">
                {creating ? "Saving..." : "Save Enquiry"}
              </button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function CollegeAdmissionsFallback() {
  const [rows, setRows] = useState<CollegeAdmissionRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feeAmount, setFeeAmount] = useState(20000);
  const [currentSemester, setCurrentSemester] = useState(1);
  const [error, setError] = useState("");

  const filteredSlots = useMemo(() => slots.filter((slot) => slot.departmentId === departmentId), [slots, departmentId]);
  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [admissions, departmentData, slotData] = await Promise.all([
        apiFetch<CollegeAdmissionRow[]>("/api/admin/admissions"),
        apiFetch<DepartmentRow[]>("/api/admin/departments"),
        apiFetch<SlotRow[]>("/api/admin/slots"),
      ]);
      setRows(admissions);
      setDepartments(departmentData);
      setSlots(slotData);
      const firstDepartment = departmentData[0]?.id ?? "";
      setDepartmentId((current) => current || firstDepartment);
      const firstSlot = slotData.find((entry) => entry.departmentId === (departmentId || firstDepartment))?.id ?? "";
      setSlotId((current) => current || firstSlot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load admissions");
    }
  }, [departmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createAdmission = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/admin/admissions", {
        method: "POST",
        body: JSON.stringify({
          departmentId,
          slotId,
          studentName,
          email,
          phone,
          currentSemester,
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

  return (
    <div className="space-y-6">
      <SectionCard title="Admissions" description="College slot + semester flow remains unchanged">
        <form onSubmit={createAdmission} className="grid gap-3 text-sm md:grid-cols-3">
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" required>
            <option value="">Select department</option>
            {departments.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
          <select value={slotId} onChange={(event) => setSlotId(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" required>
            <option value="">Select slot</option>
            {filteredSlots.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.course} (Available: {entry.availableSeats})</option>
            ))}
          </select>
          <input value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="Student Name" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Student Email" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" className="rounded-xl border border-slate-300 px-3 py-2" />
          <input type="number" min={0} value={feeAmount} onChange={(event) => setFeeAmount(Number(event.target.value || 0))} placeholder="Admission Fee" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <select value={currentSemester} onChange={(event) => setCurrentSemester(Number(event.target.value))} className="rounded-xl border border-slate-300 px-3 py-2" required>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((semester) => (
              <option key={semester} value={semester}>Semester {semester}</option>
            ))}
          </select>
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white md:col-span-3">Submit Admission</button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Recent Admissions" description="Latest created admissions">
        <div className="space-y-2 text-sm">
          {rows.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="font-semibold text-slate-900">{entry.studentName}</p>
              <p className="text-slate-600">{entry.email}</p>
              <p className="text-slate-600">Department: {deptById.get(entry.departmentId ?? "") ?? "Unknown"}</p>
              <p className="text-slate-600">Semester: {entry.currentSemester ?? "N/A"}</p>
              <p className="text-teal-700">{entry.status} • {new Date(entry.createdAt).toLocaleString()}</p>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
