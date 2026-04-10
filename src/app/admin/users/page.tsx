"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton, TableSkeleton } from "@/components/ui/skeletons";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { apiFetch } from "@/lib/clientApi";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "HOD" | "Faculty" | "Student";
  department_id: string | null;
  branch?: string | null;
  joined_on?: string | null;
  class_id?: string | null;
  className?: string | null;
  subjectNames?: string[];
}

interface DepartmentRow {
  id: string;
  name: string;
}

interface ClassRow {
  id: string;
  name: string;
}

interface SubjectRow {
  id: string;
  name: string;
  classId?: string | null;
}

export default function AdminUsersPage() {
  const { isSchool, labels } = useInstitutionType();

  const [rows, setRows] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"HOD" | "Faculty">("HOD");
  const [departmentId, setDepartmentId] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [branch, setBranch] = useState("");
  const [joinedOn, setJoinedOn] = useState("");
  const [newSubjectName, setNewSubjectName] = useState("");
  const [subjectCreating, setSubjectCreating] = useState(false);

  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const visibleSubjects = useMemo(
    () => subjects.filter((item) => !item.classId || item.classId === classId),
    [subjects, classId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const userPromise = apiFetch<UserRow[]>("/api/admin/users");
      const departmentPromise = isSchool ? Promise.resolve<DepartmentRow[]>([]) : apiFetch<DepartmentRow[]>("/api/admin/departments");
      const classPromise = isSchool ? apiFetch<ClassRow[]>("/api/admin/classes") : Promise.resolve<ClassRow[]>([]);
      const subjectPromise = isSchool ? apiFetch<SubjectRow[]>("/api/admin/subjects") : Promise.resolve<SubjectRow[]>([]);

      const [userData, departmentData, classData, subjectData] = await Promise.all([
        userPromise,
        departmentPromise,
        classPromise,
        subjectPromise,
      ]);
      setRows(userData);
      setDepartments(departmentData);
      setClasses(classData);
      setSubjects(subjectData);
      setDepartmentId((current) => current || departmentData[0]?.id || "");
      setClassId((current) => current || classData[0]?.id || "");
      setSubjectId((current) => current || subjectData[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load user management data");
    } finally {
      setLoading(false);
    }
  }, [isSchool]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!isSchool || role !== "Faculty") return;
    if (!subjectId) return;
    if (!visibleSubjects.some((item) => item.id === subjectId)) {
      setSubjectId(visibleSubjects[0]?.id || "");
    }
  }, [isSchool, role, subjectId, visibleSubjects]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) return;
    if (!isSchool && !departmentId) return;
    if (isSchool && !classId) return;
    if (isSchool && role === "Faculty" && !subjectId) return;

    setError("");
    try {
      await apiFetch<UserRow>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password: password.trim(),
          role,
          departmentId: isSchool ? null : departmentId || null,
          classId: isSchool ? classId || null : null,
          subjectId: isSchool && role === "Faculty" ? subjectId || null : null,
          branch: branch || null,
          joinedOn: joinedOn || null,
        }),
      });
      setName("");
      setEmail("");
      setPassword("");
      setBranch("");
      setJoinedOn("");
      setSubjectId((current) => (isSchool && role === "Faculty" ? current : ""));
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create user");
    }
  };

  const handleCreateSubject = async () => {
    if (!isSchool || !classId || !newSubjectName.trim()) return;

    setError("");
    setSubjectCreating(true);
    try {
      const created = await apiFetch<SubjectRow>("/api/admin/subjects", {
        method: "POST",
        body: JSON.stringify({
          name: newSubjectName.trim(),
          classId,
          departmentId: null,
          type: "theory",
          periodsPerWeek: 5,
        }),
      });

      setSubjects((current) => {
        const exists = current.some((item) => item.id === created.id);
        return exists ? current : [...current, created].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSubjectId(created.id);
      setNewSubjectName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create subject");
    } finally {
      setSubjectCreating(false);
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
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch (optional)"
            className="rounded-xl border border-slate-300 px-3 py-2"
          />
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Joining Date</span>
            <input
              type="date"
              value={joinedOn}
              onChange={(e) => setJoinedOn(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <select value={role} onChange={(e) => setRole(e.target.value as "HOD" | "Faculty")} className="rounded-xl border border-slate-300 px-3 py-2">
            <option value="HOD">HOD</option>
            <option value="Faculty">Faculty</option>
          </select>

          {isSchool ? (
            <>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 md:col-span-2"
                required
              >
                <option value="">Select {labels.class_entity.toLowerCase()}</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>

              {role === "Faculty" ? (
                <>
                  <select
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 md:col-span-2"
                    required
                  >
                    <option value="">Select subject</option>
                    {visibleSubjects.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>

                  <div className="grid gap-2 md:col-span-2 md:grid-cols-[1fr_auto]">
                    <input
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder="Create new subject (e.g. Mathematics)"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <button
                      type="button"
                      onClick={handleCreateSubject}
                      disabled={subjectCreating || !classId || !newSubjectName.trim()}
                      className="rounded-xl bg-slate-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {subjectCreating ? "Creating..." : "Create Subject"}
                    </button>
                  </div>
                  {visibleSubjects.length === 0 ? (
                    <p className="text-xs text-amber-700 md:col-span-2">No subject found for selected {labels.class_entity.toLowerCase()}. Create one above.</p>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 md:col-span-2" required>
              <option value="">Select department</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          )}

          <button type="submit" className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white md:col-span-2">
            Create User
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="HOD List" description={isSchool ? "Class heads in this institution" : "Department heads in this college"}>
          {loading ? <TableSkeleton rows={4} /> : null}
          <div className="space-y-2 text-sm">
            {hodRows.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-semibold text-slate-800">{item.name}</p>
                <p className="text-slate-600">{item.email}</p>
                {isSchool ? (
                  <p className="text-teal-700">{labels.class_entity}: {item.className ?? (item.class_id ? classById.get(item.class_id) ?? "Unknown" : "—")}</p>
                ) : (
                  <p className="text-teal-700">Department: {item.department_id ? deptById.get(item.department_id) ?? "Unknown" : "—"}</p>
                )}
                <p className="text-slate-600">Branch: {item.branch ?? "—"}</p>
                <p className="text-slate-600">Joined On: {item.joined_on ? new Date(item.joined_on).toLocaleDateString() : "—"}</p>
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
                {isSchool ? (
                  <>
                    <p className="text-teal-700">{labels.class_entity}: {item.className ?? (item.class_id ? classById.get(item.class_id) ?? "Unknown" : "—")}</p>
                    <p className="text-slate-600">Subjects: {(item.subjectNames ?? []).length ? (item.subjectNames ?? []).join(", ") : "—"}</p>
                  </>
                ) : (
                  <p className="text-teal-700">Department: {item.department_id ? deptById.get(item.department_id) ?? "Unknown" : "—"}</p>
                )}
                <p className="text-slate-600">Branch: {item.branch ?? "—"}</p>
                <p className="text-slate-600">Joined On: {item.joined_on ? new Date(item.joined_on).toLocaleDateString() : "—"}</p>
              </div>
            ))}
            {facultyRows.length === 0 && !loading ? <p className="text-xs text-slate-600">No faculty yet.</p> : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
