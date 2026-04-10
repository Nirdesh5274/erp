"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionCard } from "@/components/ui/SectionCard";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { apiFetch } from "@/lib/clientApi";

interface StudentRow {
  id: string;
  name: string;
  email: string;
  department_id: string | null;
  slot_id?: string | null;
  class_id?: string | null;
  section_id?: string | null;
  roll_number?: string | null;
  term?: string | null;
  status?: "active" | "inactive" | "graduated" | null;
  current_semester?: number | null;
  created_at: string;
  temp_password?: string | null;
  must_change_password?: boolean | null;
  password_generated_at?: string | null;
}

interface StudentListResponse {
  rows: StudentRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
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

interface ClassRow {
  id: string;
  name: string;
}

interface SectionRow {
  id: string;
  name: string;
  classId: string;
  availableSeats: number;
}

interface AdmissionCreateResponse {
  studentCredentials?: {
    email: string;
    tempPassword: string;
    mustChangePassword: boolean;
  } | null;
}

interface SemesterUpgradeResponse {
  studentId: string;
  previousSemester: number;
  currentSemester: number;
  feeStructureId?: string;
  feeGenerated?: boolean;
  generatedFeeId?: string | null;
  upgradedAt: string;
}

interface BulkSemesterUpgradeResponse {
  slotId: string;
  fromSemester: number;
  targetSemester: number;
  totalCandidates: number;
  upgradedCount: number;
  skippedCount: number;
  results: Array<{
    studentId: string;
    name: string;
    upgraded: boolean;
    message: string;
  }>;
}

export default function AdminStudentsPage() {
  const { isSchool } = useInstitutionType();
  if (!isSchool) return <CollegeStudentsPage />;
  return <SchoolStudentsPage />;
}

function CollegeStudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "graduated">("all");
  const [semesterFilter, setSemesterFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const departmentById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
  const slotById = useMemo(() => new Map(slots.map((item) => [item.id, item.course])), [slots]);

  const departmentSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of students) {
      const key = student.department_id ?? "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        name: id === "unknown" ? "Unknown" : departmentById.get(id) ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [students, departmentById]);

  const visibleStudents = useMemo(() => {
    if (semesterFilter === "all") return students;
    const selected = Number(semesterFilter);
    return students.filter((student) => Number(student.current_semester ?? 0) === selected);
  }, [students, semesterFilter]);

  const loadReferenceData = useCallback(async () => {
    const [departmentData, slotData] = await Promise.all([
      apiFetch<DepartmentRow[]>("/api/admin/departments"),
      apiFetch<SlotRow[]>("/api/admin/slots"),
    ]);
    setDepartments(departmentData);
    setSlots(slotData);
  }, []);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("page", String(page));
      query.set("limit", "20");
      if (search.trim()) query.set("search", search.trim());
      if (departmentFilter) query.set("departmentId", departmentFilter);
      if (statusFilter !== "all") query.set("status", statusFilter);

      const data = await apiFetch<StudentListResponse>(`/api/admin/students?${query.toString()}`);
      setStudents(data.rows);
      setTotalPages(data.totalPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load students");
    } finally {
      setLoading(false);
    }
  }, [page, search, departmentFilter, statusFilter]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const regeneratePassword = async (studentId: string) => {
    setError("");
    setSuccess("");
    try {
      const data = await apiFetch<{ email: string; tempPassword: string }>("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({ studentId, action: "regeneratePassword" }),
      });
      setSuccess(`Temporary password regenerated for ${data.email}: ${data.tempPassword}`);
      await loadStudents();
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : "Unable to reset password");
    }
  };

  const deactivateStudent = async (studentId: string) => {
    const confirmed = window.confirm("Deactivate this student?");
    if (!confirmed) return;
    setError("");
    setSuccess("");
    try {
      await apiFetch("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({ studentId, action: "deactivate" }),
      });
      setSuccess("Student deactivated");
      await loadStudents();
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : "Unable to deactivate student");
    }
  };

  const upgradeSemester = async (student: StudentRow) => {
    const currentSemester = Number(student.current_semester ?? 1);
    const raw = window.prompt("Enter target semester", String(currentSemester + 1));
    if (!raw) return;
    const targetSemester = Number(raw);
    if (!Number.isFinite(targetSemester) || targetSemester < 1) {
      setError("Enter a valid semester");
      return;
    }

    setError("");
    setSuccess("");
    try {
      const response = await apiFetch<SemesterUpgradeResponse>("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({ studentId: student.id, action: "upgradeSemester", targetSemester }),
      });
      setSuccess(`${student.name} upgraded to semester ${response.currentSemester}`);
      await loadStudents();
    } catch (upgradeError) {
      setError(upgradeError instanceof Error ? upgradeError.message : "Unable to upgrade semester");
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Students" description="Department-wise student details with semester and status">
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={departmentFilter}
            onChange={(event) => {
              setDepartmentFilter(event.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All departments</option>
            {departments.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="graduated">Graduated</option>
          </select>
          <select
            value={semesterFilter}
            onChange={(event) => setSemesterFilter(event.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All semesters</option>
            {Array.from({ length: 12 }, (_, idx) => (
              <option key={idx + 1} value={String(idx + 1)}>Semester {idx + 1}</option>
            ))}
          </select>
        </div>

        {departmentSummary.length > 0 ? (
          <div className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-4">
            {departmentSummary.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p className="font-semibold text-slate-800">{entry.name}</p>
                <p>{entry.count} students</p>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

        {loading ? <p className="text-sm text-slate-600">Loading students...</p> : null}
        {!loading && visibleStudents.length === 0 ? <p className="text-sm text-slate-500">No students found for selected filters.</p> : null}

        {!loading && visibleStudents.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Email</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Department</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Course</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Semester</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Created</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {visibleStudents.map((student) => (
                  <tr key={student.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">{student.name}</td>
                    <td className="px-3 py-2 text-slate-700">{student.email}</td>
                    <td className="px-3 py-2 text-slate-700">{departmentById.get(student.department_id ?? "") ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-700">{slotById.get(student.slot_id ?? "") ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-700">{student.current_semester ?? "-"}</td>
                    <td className="px-3 py-2 capitalize text-slate-700">{student.status ?? "active"}</td>
                    <td className="px-3 py-2 text-slate-700">{new Date(student.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => void regeneratePassword(student.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Reset PW</button>
                        <button onClick={() => void upgradeSemester(student)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Upgrade Sem</button>
                        <button onClick={() => void deactivateStudent(student.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Deactivate</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <p>Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-60">Prev</button>
            <button onClick={() => setPage((current) => Math.min(current + 1, totalPages))} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-60">Next</button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function SchoolStudentsPage() {
  const router = useRouter();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [passwordModal, setPasswordModal] = useState<{ email: string; tempPassword: string } | null>(null);
  const [editingStudent, setEditingStudent] = useState<StudentRow | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRollNumber, setEditRollNumber] = useState("");
  const [editClassId, setEditClassId] = useState("");
  const [editSectionId, setEditSectionId] = useState("");
  const [editTerm, setEditTerm] = useState("Term1");
  const [editStatus, setEditStatus] = useState<"active" | "inactive" | "graduated">("active");

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "graduated">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [classId, setClassId] = useState("");

  const [fromClassId, setFromClassId] = useState("");
  const [targetClassId, setTargetClassId] = useState("");
  const [targetSectionId, setTargetSectionId] = useState("");
  const [targetTerm, setTargetTerm] = useState("Term2");
  const [promotePreview, setPromotePreview] = useState<StudentRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const sectionById = useMemo(() => new Map(sections.map((item) => [item.id, item.name])), [sections]);
  const promoteSections = useMemo(() => sections.filter((entry) => entry.classId === targetClassId), [sections, targetClassId]);
  const editSections = useMemo(() => sections.filter((entry) => entry.classId === editClassId), [sections, editClassId]);

  const loadReferenceData = useCallback(async () => {
    const [classData, sectionData] = await Promise.all([
      apiFetch<ClassRow[]>("/api/admin/classes"),
      apiFetch<SectionRow[]>("/api/admin/sections"),
    ]);
    setClasses(classData);
    setSections(sectionData);
    const initialClass = classData[0]?.id ?? "";
    setClassId((current) => current || initialClass);
    setFromClassId((current) => current || initialClass);
    setTargetClassId((current) => current || classData[1]?.id || initialClass);
  }, []);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("page", String(page));
      query.set("limit", "20");
      if (search.trim()) query.set("search", search.trim());
      if (classFilter) query.set("classId", classFilter);
      if (sectionFilter) query.set("sectionId", sectionFilter);
      if (statusFilter !== "all") query.set("status", statusFilter);

      const data = await apiFetch<StudentListResponse>(`/api/admin/students?${query.toString()}`);
      setStudents(data.rows);
      setTotalPages(data.totalPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load students");
    } finally {
      setLoading(false);
    }
  }, [page, search, classFilter, sectionFilter, statusFilter]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const regeneratePassword = async (studentId: string) => {
    setError("");
    setSuccess("");
    try {
      const data = await apiFetch<{ email: string; tempPassword: string }>("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({ studentId, action: "regeneratePassword" }),
      });
      setPasswordModal({ email: data.email, tempPassword: data.tempPassword });
      await loadStudents();
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : "Unable to reset password");
    }
  };

  const deactivateStudent = async (studentId: string) => {
    const confirmed = window.confirm("Deactivate this student?");
    if (!confirmed) return;
    try {
      await apiFetch("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({ studentId, action: "deactivate" }),
      });
      setSuccess("Student deactivated");
      await loadStudents();
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : "Unable to deactivate student");
    }
  };

  const previewEligibleStudents = async () => {
    if (!fromClassId) {
      setError("Select from class first");
      return;
    }
    setLoadingPreview(true);
    setError("");
    try {
      const data = await apiFetch<StudentListResponse>(`/api/admin/students?classId=${encodeURIComponent(fromClassId)}&status=active&page=1&limit=100`);
      setPromotePreview(data.rows);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Unable to load eligible students");
    } finally {
      setLoadingPreview(false);
    }
  };

  const promoteStudents = async () => {
    if (!fromClassId || !targetClassId) {
      setError("Select from/to class first");
      return;
    }

    setPromoting(true);
    setError("");
    try {
      const result = await apiFetch<BulkSemesterUpgradeResponse>("/api/admin/students/bulk-promote", {
        method: "POST",
        body: JSON.stringify({
          fromClassId,
          targetClassId,
          targetSectionId: targetSectionId || undefined,
          targetTerm,
        }),
      });

      setSuccess(`Promotion completed: ${result.upgradedCount}/${result.totalCandidates} upgraded`);
      setShowPromoteModal(false);
      await loadStudents();
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : "Unable to promote class");
    } finally {
      setPromoting(false);
    }
  };

  const openEditModal = (student: StudentRow) => {
    setEditingStudent(student);
    setEditName(student.name ?? "");
    setEditEmail(student.email ?? "");
    setEditRollNumber(student.roll_number ?? "");
    setEditClassId(student.class_id ?? "");
    setEditSectionId(student.section_id ?? "");
    setEditTerm(student.term ?? "Term1");
    setEditStatus((student.status ?? "active") as "active" | "inactive" | "graduated");
  };

  const saveStudentDetails = async () => {
    if (!editingStudent) return;
    if (!editName.trim()) {
      setError("Student name is required");
      return;
    }
    if (!editEmail.trim()) {
      setError("Student email is required");
      return;
    }
    if (!editClassId) {
      setError("Class is required");
      return;
    }
    if (!editSectionId) {
      setError("Section is required");
      return;
    }

    setSavingEdit(true);
    setError("");
    setSuccess("");

    try {
      await apiFetch("/api/admin/students", {
        method: "PATCH",
        body: JSON.stringify({
          studentId: editingStudent.id,
          action: "updateDetails",
          name: editName.trim(),
          email: editEmail.trim().toLowerCase(),
          rollNumber: editRollNumber.trim() || null,
          classId: editClassId,
          sectionId: editSectionId,
          term: editTerm,
          status: editStatus,
        }),
      });

      setEditingStudent(null);
      setSuccess("Student details updated");
      await loadStudents();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update student details");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Students" description="Manage confirmed and active students">
        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={() => router.push("/admin/enquiries")} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">+ Add Student</button>
          <button onClick={() => setShowPromoteModal(true)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Promote Class</button>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by name or roll" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setPage(1); }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All classes</option>
            {classes.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
          <select value={sectionFilter} onChange={(event) => { setSectionFilter(event.target.value); setPage(1); }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All sections</option>
            {sections.filter((entry) => !classFilter || entry.classId === classFilter).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="graduated">Graduated</option>
          </select>
        </div>

        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

        {loading ? <p className="text-sm text-slate-600">Loading students...</p> : null}
        {!loading && students.length === 0 ? <p className="text-sm text-slate-500">No students found for selected filters.</p> : null}

        {!loading && students.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Roll No</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Class</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Section</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Term</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {students.map((student) => (
                  <tr key={student.id}>
                    <td className="px-3 py-2">{student.name}</td>
                    <td className="px-3 py-2">{student.roll_number ?? "-"}</td>
                    <td className="px-3 py-2">{classById.get(student.class_id ?? "") ?? "-"}</td>
                    <td className="px-3 py-2">{sectionById.get(student.section_id ?? "") ?? "-"}</td>
                    <td className="px-3 py-2">{student.term ?? "-"}</td>
                    <td className="px-3 py-2 capitalize">{student.status ?? "active"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => window.alert(`Student: ${student.name}\nEmail: ${student.email}`)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">View</button>
                        <button onClick={() => void regeneratePassword(student.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Reset PW</button>
                        <select
                          defaultValue=""
                          onChange={(event) => {
                            const action = event.target.value;
                            if (!action) return;
                            if (action === "deactivate") {
                              void deactivateStudent(student.id);
                            } else if (action === "promote") {
                              setFromClassId(student.class_id ?? "");
                              setShowPromoteModal(true);
                            } else if (action === "fees") {
                              const classIdForFees = student.class_id ?? classFilter;
                              if (!classIdForFees) {
                                setError("Student class not found. Please open Fees page and choose class manually.");
                              } else {
                                router.push(`/admin/fees?classId=${encodeURIComponent(classIdForFees)}&studentId=${encodeURIComponent(student.id)}`);
                              }
                            } else if (action === "edit") {
                              openEditModal(student);
                            }
                            event.currentTarget.value = "";
                          }}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="">More...</option>
                          <option value="edit">Edit details</option>
                          <option value="fees">View fee history</option>
                          <option value="promote">Promote to next class</option>
                          <option value="deactivate">Deactivate</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <p>Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-60">Prev</button>
            <button onClick={() => setPage((current) => Math.min(current + 1, totalPages))} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-60">Next</button>
          </div>
        </div>
      </SectionCard>

      {showPromoteModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Promote Class</h2>
              <button onClick={() => setShowPromoteModal(false)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm">Close</button>
            </div>

            <div className="grid gap-3 text-sm md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">From Class</span>
                <select value={fromClassId} onChange={(event) => setFromClassId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="">Select source class</option>
                  {classes.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">To Class</span>
                <select value={targetClassId} onChange={(event) => setTargetClassId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="">Select target class</option>
                  {classes.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Target Section</span>
                <select value={targetSectionId} onChange={(event) => setTargetSectionId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="">Keep current section</option>
                  {promoteSections.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Target Term</span>
                <select value={targetTerm} onChange={(event) => setTargetTerm(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="Term1">Term1</option>
                  <option value="Term2">Term2</option>
                  <option value="Annual">Annual</option>
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => void previewEligibleStudents()} disabled={loadingPreview} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                {loadingPreview ? "Loading..." : "Show Eligible Students"}
              </button>
              <button onClick={() => void promoteStudents()} disabled={promoting} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
                {promoting ? "Promoting..." : "Promote Selected"}
              </button>
            </div>

            <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-slate-200 p-3 text-sm">
              {promotePreview.length === 0 ? <p className="text-slate-500">No preview loaded yet.</p> : null}
              {promotePreview.map((entry) => (
                <p key={entry.id} className="text-slate-700">{entry.name} • {entry.roll_number ?? "-"}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {passwordModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">New Password Generated</h2>
            <p className="text-sm text-slate-700">Email: {passwordModal.email}</p>
            <p className="mb-4 text-sm text-slate-700">Password: {passwordModal.tempPassword}</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(`Email: ${passwordModal.email}\nPassword: ${passwordModal.tempPassword}`);
                }}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              >
                Copy
              </button>
              <button onClick={() => setPasswordModal(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {editingStudent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Edit Student Details</h2>
              <button onClick={() => setEditingStudent(null)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm">Close</button>
            </div>

            <div className="grid gap-3 text-sm md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Name</span>
                <input value={editName} onChange={(event) => setEditName(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Email</span>
                <input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Roll Number</span>
                <input value={editRollNumber} onChange={(event) => setEditRollNumber(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Status</span>
                <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as "active" | "inactive" | "graduated")} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="graduated">Graduated</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Class</span>
                <select value={editClassId} onChange={(event) => { setEditClassId(event.target.value); setEditSectionId(""); }} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="">Select class</option>
                  {classes.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Section</span>
                <select value={editSectionId} onChange={(event) => setEditSectionId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="">Select section</option>
                  {editSections.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Term</span>
                <select value={editTerm} onChange={(event) => setEditTerm(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option value="Term1">Term1</option>
                  <option value="Term2">Term2</option>
                  <option value="Annual">Annual</option>
                </select>
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => void saveStudentDetails()} disabled={savingEdit} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70">
                {savingEdit ? "Saving..." : "Save Changes"}
              </button>
              <button onClick={() => setEditingStudent(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

