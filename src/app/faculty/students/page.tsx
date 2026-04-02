"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { apiFetch } from "@/lib/clientApi";

interface AdmissionRow {
  id: string;
  studentName: string;
  email: string;
  phone: string | null;
  status: string;
  createdAt: string;
  departmentId: string;
  slotId: string;
  sectionId?: string | null;
  rollNumber?: string | null;
  term?: "Term1" | "Term2" | "Annual" | null;
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
  classId: string;
  name: string;
  availableSeats?: number;
}

interface AdmissionCreateResponse {
  studentCredentials?: {
    email: string;
    tempPassword: string;
    mustChangePassword: boolean;
  } | null;
}

export default function FacultyStudentsPage() {
  const { isSchool, labels } = useInstitutionType();

  const [rows, setRows] = useState<AdmissionRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [departmentId, setDepartmentId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [term, setTerm] = useState<"Term1" | "Term2" | "Annual">("Term1");
  const [studentName, setStudentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feeAmount, setFeeAmount] = useState(20000);
  const [credentialsMsg, setCredentialsMsg] = useState("");

  const deptById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const sectionById = useMemo(() => new Map(sections.map((item) => [item.id, item])), [sections]);
  const filteredSlots = slots.filter((slot) => slot.departmentId === departmentId);
  const filteredSections = sections.filter((item) => item.classId === classId);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (isSchool) {
        const [admissionData, classData, sectionData] = await Promise.all([
          apiFetch<AdmissionRow[]>("/api/admin/admissions"),
          apiFetch<ClassRow[]>("/api/admin/classes"),
          apiFetch<SectionRow[]>("/api/admin/sections"),
        ]);

        setRows(admissionData);
        setClasses(classData);
        setSections(sectionData);
        setDepartments([]);
        setSlots([]);

        const nextClassId = classId || classData[0]?.id || sectionData[0]?.classId || "";
        setClassId(nextClassId);
        setSectionId((currentSectionId) => {
          const validSections = sectionData.filter((item) => item.classId === nextClassId);
          if (validSections.some((item) => item.id === currentSectionId)) return currentSectionId;
          return validSections[0]?.id || "";
        });
      } else {
        const [admissionData, departmentData, slotData] = await Promise.all([
          apiFetch<AdmissionRow[]>("/api/admin/admissions"),
          apiFetch<DepartmentRow[]>("/api/admin/departments"),
          apiFetch<SlotRow[]>("/api/admin/slots"),
        ]);
        setRows(admissionData);
        setDepartments(departmentData);
        setSlots(slotData);
        setClasses([]);
        setSections([]);

        setDepartmentId((currentDepartmentId) => {
          const nextDepartmentId = currentDepartmentId || departmentData[0]?.id || "";

          setSlotId((currentSlotId) => {
            const matchingSlots = slotData.filter((slot) => slot.departmentId === nextDepartmentId);
            if (matchingSlots.some((slot) => slot.id === currentSlotId)) return currentSlotId;
            return matchingSlots[0]?.id ?? "";
          });

          return nextDepartmentId;
        });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load student admissions");
    } finally {
      setLoading(false);
    }
  }, [isSchool, classId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setCredentialsMsg("");

    try {
      const created = await apiFetch<AdmissionCreateResponse>("/api/admin/admissions", {
        method: "POST",
        body: JSON.stringify({
          departmentId: isSchool ? undefined : departmentId,
          slotId: isSchool ? undefined : slotId,
          classId: isSchool ? classId : undefined,
          sectionId: isSchool ? sectionId : undefined,
          term: isSchool ? term : undefined,
          studentName,
          email,
          phone: phone || null,
          feeAmount,
        }),
      });
      setStudentName("");
      setEmail("");
      setPhone("");
      if (created.studentCredentials) {
        setCredentialsMsg(
          `Student login created. Email: ${created.studentCredentials.email} | Temp Password: ${created.studentCredentials.tempPassword}`,
        );
      }
      await load();
      toast.success("Student admission created");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to create student";
      setError(message);
      toast.error(message);
    }
  };

  const handlePhoneChange = (value: string) => {
    setPhone(value.replace(/\D/g, "").slice(0, 10));
  };

  if (loading && rows.length === 0 && departments.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Add Student" description={isSchool ? "Faculty can admit students in assigned class/section" : "Faculty can admit students in their own department only"}>
        <form onSubmit={handleCreate} className="grid gap-3 text-sm md:grid-cols-3">
          {isSchool ? (
            <>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">{labels.class_entity}</span>
                <select
                  value={classId}
                  onChange={(e) => {
                    const nextClassId = e.target.value;
                    setClassId(nextClassId);
                    const firstSection = sections.find((item) => item.classId === nextClassId);
                    setSectionId(firstSection?.id ?? "");
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  required
                >
                  <option value="">Select {labels.class_entity.toLowerCase()}</option>
                  {classes.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">{labels.section_entity}</span>
                <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
                  <option value="">Select {labels.section_entity.toLowerCase()}</option>
                  {filteredSections.map((item) => (
                    <option key={item.id} value={item.id}>{item.name} ({item.availableSeats ?? 0} seats)</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Term</span>
                <select value={term} onChange={(e) => setTerm(e.target.value as "Term1" | "Term2" | "Annual")} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
                  <option value="Term1">Term1</option>
                  <option value="Term2">Term2</option>
                  <option value="Annual">Annual</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Department</span>
                <select
                  value={departmentId}
                  onChange={(e) => {
                    const nextDepartmentId = e.target.value;
                    setDepartmentId(nextDepartmentId);
                    const firstSlot = slots.find((slot) => slot.departmentId === nextDepartmentId);
                    setSlotId(firstSlot?.id ?? "");
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  required
                >
                  <option value="">Select department</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Slot / Course</span>
                <select value={slotId} onChange={(e) => setSlotId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
                  <option value="">Select slot</option>
                  {filteredSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>{slot.course} (Available: {slot.availableSeats})</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Student Name</span>
            <input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Student full name" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Student Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@example.com" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Phone Number</span>
            <input
              type="tel"
              inputMode="numeric"
              pattern="\\d{10}"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="10-digit mobile number"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Admission Fee</span>
            <input type="number" min={0} value={feeAmount} onChange={(e) => setFeeAmount(Number(e.target.value))} placeholder="Admission fee amount" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white md:col-span-3">Create Student Admission</button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        {credentialsMsg ? <p className="mt-3 text-sm text-emerald-700">{credentialsMsg}</p> : null}
      </SectionCard>

      <SectionCard title="Recent Student Admissions" description="Filtered by your access rules">
        <div className="space-y-3">
          {rows.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-800">{item.studentName}</p>
              <p className="text-slate-600">{item.email}</p>
              {isSchool ? (
                <>
                  <p className="text-slate-600">{labels.class_entity}: {item.sectionId ? classById.get(sectionById.get(item.sectionId)?.classId ?? "") ?? "Unknown" : "—"}</p>
                  <p className="text-slate-600">{labels.section_entity}: {item.sectionId ? sectionById.get(item.sectionId)?.name ?? "Unknown" : "—"}</p>
                  <p className="text-slate-600">Term: {item.term ?? "—"}</p>
                </>
              ) : (
                <p className="text-slate-600">Department: {deptById.get(item.departmentId) ?? "Unknown"}</p>
              )}
              <p className="text-teal-700">{item.status} • {new Date(item.createdAt).toLocaleString()}</p>
            </div>
          ))}
          {rows.length === 0 ? <p className="text-xs text-slate-600">No admissions yet.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
