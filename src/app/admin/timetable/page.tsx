"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { apiFetch } from "@/lib/clientApi";

interface SectionRow {
  id: string;
  name: string;
  classId: string;
}

interface SubjectRow {
  id: string;
  name: string;
  classId?: string | null;
}

interface UserRow {
  id: string;
  name: string;
  role: string;
  class_id?: string | null;
  className?: string | null;
  subjectNames?: string[];
}

interface ClassRow {
  id: string;
  name: string;
}

interface TimetableRow {
  id: string;
  sectionId: string;
  subjectId: string | null;
  teacherId: string;
  day: string;
  periodNumber: number;
  startTime: string | null;
  endTime: string | null;
}

interface PeriodDraft {
  subjectId: string;
  teacherId: string;
  startTime: string;
  endTime: string;
  existingId: string | null;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PERIODS = Array.from({ length: 8 }, (_, index) => index + 1);

export default function AdminTimetablePage() {
  const { isSchool } = useInstitutionType();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [teachers, setTeachers] = useState<UserRow[]>([]);
  const [rows, setRows] = useState<TimetableRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [day, setDay] = useState("Monday");
  const [periodDrafts, setPeriodDrafts] = useState<Record<number, PeriodDraft>>({});
  const classNameById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const subjectNameById = useMemo(() => new Map(subjects.map((item) => [item.id, item.name])), [subjects]);

  const classSections = useMemo(
    () => sections.filter((section) => section.classId === classId),
    [sections, classId],
  );

  const classSubjects = useMemo(
    () => subjects.filter((subject) => !subject.classId || subject.classId === classId),
    [subjects, classId],
  );

  const classSubjectNameSet = useMemo(
    () => new Set(classSubjects.map((subject) => subject.name.toLowerCase())),
    [classSubjects],
  );

  const classTeachers = useMemo(
    () => teachers.filter((teacher) => {
      if (teacher.class_id && teacher.class_id === classId) return true;
      if (teacher.className && teacher.className === classNameById.get(classId)) return true;
      const mappedSubjects = teacher.subjectNames ?? [];
      return mappedSubjects.some((name) => classSubjectNameSet.has(name.toLowerCase()));
    }),
    [teachers, classId, classNameById, classSubjectNameSet],
  );

  const buildPeriodDrafts = useCallback((params: {
    activeRows: TimetableRow[];
    activeSectionId: string;
    activeDay: string;
    fallbackTeacherId?: string;
  }) => {
    const { activeRows, activeSectionId, activeDay, fallbackTeacherId } = params;
    const scopedRows = activeRows.filter((row) => row.sectionId === activeSectionId && row.day === activeDay);
    const nextDrafts: Record<number, PeriodDraft> = {};

    for (const period of PERIODS) {
      const match = scopedRows.find((row) => Number(row.periodNumber) === period) ?? null;
      nextDrafts[period] = {
        subjectId: match?.subjectId ?? "",
        teacherId: match?.teacherId ?? fallbackTeacherId ?? "",
        startTime: match?.startTime ?? "",
        endTime: match?.endTime ?? "",
        existingId: match?.id ?? null,
      };
    }

    return nextDrafts;
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const [classData, sectionData, subjectData, userData, timetableData] = await Promise.all([
        apiFetch<ClassRow[]>("/api/admin/classes"),
        apiFetch<SectionRow[]>("/api/admin/sections"),
        apiFetch<SubjectRow[]>("/api/admin/subjects"),
        apiFetch<UserRow[]>("/api/admin/users?role=Faculty"),
        apiFetch<TimetableRow[]>("/api/admin/timetable"),
      ]);
      setClasses(classData);
      setSections(sectionData);
      setSubjects(subjectData);
      setTeachers(userData);
      setRows(timetableData);

      const selectedClassId = classId && classData.some((item) => item.id === classId)
        ? classId
        : classData[0]?.id || sectionData[0]?.classId || "";
      const scopedSections = sectionData.filter((item) => item.classId === selectedClassId);
      const selectedSectionId = sectionId && scopedSections.some((item) => item.id === sectionId)
        ? sectionId
        : scopedSections[0]?.id || "";

      setClassId(selectedClassId);
      setSectionId(selectedSectionId);
      setPeriodDrafts(buildPeriodDrafts({
        activeRows: timetableData,
        activeSectionId: selectedSectionId,
        activeDay: day,
        fallbackTeacherId: userData[0]?.id,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load timetable");
    }
  }, [buildPeriodDrafts, classId, day, sectionId]);

  useEffect(() => {
    if (!isSchool) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isSchool, load]);

  const handleClassChange = (nextClassId: string) => {
    setClassId(nextClassId);
    const nextSections = sections.filter((item) => item.classId === nextClassId);
    const nextSectionId = nextSections.some((item) => item.id === sectionId)
      ? sectionId
      : (nextSections[0]?.id || "");

    setSectionId(nextSectionId);
    setPeriodDrafts(buildPeriodDrafts({
      activeRows: rows,
      activeSectionId: nextSectionId,
      activeDay: day,
      fallbackTeacherId: classTeachers[0]?.id || teachers[0]?.id,
    }));
  };

  const handleSectionChange = (nextSectionId: string) => {
    setSectionId(nextSectionId);
    setPeriodDrafts(buildPeriodDrafts({
      activeRows: rows,
      activeSectionId: nextSectionId,
      activeDay: day,
      fallbackTeacherId: classTeachers[0]?.id || teachers[0]?.id,
    }));
  };

  const handleDayChange = (nextDay: string) => {
    setDay(nextDay);
    setPeriodDrafts(buildPeriodDrafts({
      activeRows: rows,
      activeSectionId: sectionId,
      activeDay: nextDay,
      fallbackTeacherId: classTeachers[0]?.id || teachers[0]?.id,
    }));
  };

  const savePeriod = async (periodNumber: number) => {
    setError("");
    setSuccess("");
    const draft = periodDrafts[periodNumber];
    if (!draft || !classId || !sectionId || !draft.subjectId || !draft.teacherId) {
      setError("Select class, section, subject, and teacher for this period");
      return;
    }

    try {
      if (draft.existingId) {
        await apiFetch<TimetableRow>(`/api/admin/timetable/${draft.existingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            sectionId,
            subjectId: draft.subjectId || null,
            teacherId: draft.teacherId,
            day,
            periodNumber,
            startTime: draft.startTime || null,
            endTime: draft.endTime || null,
          }),
        });
      } else {
        await apiFetch<TimetableRow>("/api/admin/timetable", {
          method: "POST",
          body: JSON.stringify({
            sectionId,
            subjectId: draft.subjectId || null,
            teacherId: draft.teacherId,
            day,
            periodNumber,
            startTime: draft.startTime || null,
            endTime: draft.endTime || null,
          }),
        });
      }

      setSuccess(`Saved ${day} period ${periodNumber}`);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to save timetable entry");
    }
  };

  const deleteEntry = async (periodNumber: number) => {
    setError("");
    setSuccess("");
    const id = periodDrafts[periodNumber]?.existingId;
    if (!id) return;
    try {
      await apiFetch(`/api/admin/timetable/${id}`, { method: "DELETE" });
      setSuccess("Timetable entry removed");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete entry");
    }
  };

  if (!isSchool) {
    return (
      <SectionCard title="Timetable" description="School timetable is disabled in college mode">
        <p className="text-sm text-slate-700">Switch institution type to school from SuperAdmin Colleges to enable this page.</p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Timetable Grid" description="Select class and section, then configure day-wise 8 periods">
        {classes.length === 0 ? <p className="text-sm text-slate-700">Setup Classes first</p> : null}
        <div className="mb-4 grid gap-3 text-sm md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Class</span>
            <select value={classId} onChange={(e) => handleClassChange(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
              <option value="">Select class</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Section</span>
            <select value={sectionId} onChange={(e) => handleSectionChange(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" required>
              <option value="">Select section</option>
              {classSections.map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {DAYS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => handleDayChange(item)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${day === item ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {item.slice(0, 3)}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {PERIODS.map((period) => {
            const draft = periodDrafts[period] ?? {
              subjectId: "",
              teacherId: teachers[0]?.id ?? "",
              startTime: "",
              endTime: "",
              existingId: null,
            };
            return (
              <div key={period} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-6">
                <div className="flex items-center font-semibold text-slate-800">Period {period}</div>

                <select
                  value={draft.subjectId}
                  onChange={(e) => setPeriodDrafts((prev) => ({ ...prev, [period]: { ...draft, subjectId: e.target.value } }))}
                  className="rounded-xl border border-slate-300 px-3 py-2"
                  required
                >
                  <option value="">Subject</option>
                  {classSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>

                <select
                  value={draft.teacherId}
                  onChange={(e) => setPeriodDrafts((prev) => ({ ...prev, [period]: { ...draft, teacherId: e.target.value } }))}
                  className="rounded-xl border border-slate-300 px-3 py-2"
                  required
                >
                  <option value="">Teacher</option>
                  {classTeachers
                    .filter((teacher) => {
                      if (!draft.subjectId) return true;
                      const subjectName = subjectNameById.get(draft.subjectId)?.toLowerCase();
                      if (!subjectName) return true;
                      const mapped = (teacher.subjectNames ?? []).map((name) => name.toLowerCase());
                      return mapped.length === 0 || mapped.includes(subjectName);
                    })
                    .map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                    ))}
                </select>

                <input
                  type="time"
                  value={draft.startTime}
                  onChange={(e) => setPeriodDrafts((prev) => ({ ...prev, [period]: { ...draft, startTime: e.target.value } }))}
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />

                <input
                  type="time"
                  value={draft.endTime}
                  onChange={(e) => setPeriodDrafts((prev) => ({ ...prev, [period]: { ...draft, endTime: e.target.value } }))}
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />

                <div className="flex gap-2">
                  <button type="button" onClick={() => void savePeriod(period)} className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white">Save</button>
                  {draft.existingId ? (
                    <button type="button" onClick={() => void deleteEntry(period)} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white">Delete</button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-slate-600">
          Saved timetable is section-specific under selected class. It reflects automatically in student and faculty school dashboards.
        </p>

        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}
      </SectionCard>
    </div>
  );
}
