"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { apiFetch } from "@/lib/clientApi";

interface ClassRow {
  id: string;
  name: string;
  type: "college" | "school";
  createdAt: string;
}

interface SectionRow {
  id: string;
  classId: string;
  name: string;
  totalSeats: number;
  filledSeats: number;
  availableSeats: number;
  academicYear: string | null;
  createdAt: string;
}

export default function AdminClassesPage() {
  const { labels, isSchool } = useInstitutionType();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [className, setClassName] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [totalSeats, setTotalSeats] = useState(60);
  const [academicYear, setAcademicYear] = useState("");

  const classById = useMemo(() => new Map(classes.map((row) => [row.id, row.name])), [classes]);
  const filteredSections = useMemo(
    () => (selectedClassId ? sections.filter((section) => section.classId === selectedClassId) : sections),
    [sections, selectedClassId],
  );

  const load = async () => {
    setError("");
    try {
      const [classData, sectionData] = await Promise.all([
        apiFetch<ClassRow[]>("/api/admin/classes"),
        apiFetch<SectionRow[]>("/api/admin/sections"),
      ]);

      setClasses(classData);
      setSections(sectionData);
      setSelectedClassId((prev) => prev || classData[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load class management data");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      const created = await apiFetch<ClassRow>("/api/admin/classes", {
        method: "POST",
        body: JSON.stringify({ name: className }),
      });
      setClassName("");
      setSuccess(`${labels.class_entity} created: ${created.name}`);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `Unable to create ${labels.class_entity.toLowerCase()}`);
    }
  };

  const createSection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!selectedClassId) {
      setError(`Select ${labels.class_entity.toLowerCase()} first`);
      return;
    }
    try {
      const created = await apiFetch<SectionRow>("/api/admin/sections", {
        method: "POST",
        body: JSON.stringify({
          classId: selectedClassId,
          name: sectionName,
          totalSeats,
          academicYear: academicYear || null,
        }),
      });
      setSectionName("");
      setTotalSeats(60);
      setAcademicYear("");
      setSuccess(`${labels.section_entity} created: ${created.name}`);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `Unable to create ${labels.section_entity.toLowerCase()}`);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title={`${labels.class_entity} Setup`}
        description={isSchool ? "Manage classes and sections for school workflows" : "Manage grouped academic structure"}
      >
        <form onSubmit={createClass} className="grid gap-3 text-sm md:grid-cols-3">
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-semibold text-slate-600">{labels.class_entity} Name</span>
            <input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder={`Enter ${labels.class_entity.toLowerCase()} name`}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
          </label>
          <div className="flex items-end">
            <button className="w-full rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800">
              Add {labels.class_entity}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`${labels.section_entity} Setup`} description={`Create ${labels.section_entity.toLowerCase()} mapped to a ${labels.class_entity.toLowerCase()}`}>
        <form onSubmit={createSection} className="grid gap-3 text-sm md:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">{labels.class_entity}</span>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            >
              <option value="">Select {labels.class_entity.toLowerCase()}</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">{labels.section_entity} Name</span>
            <input
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              placeholder={isSchool ? "A / B / C" : "Batch 2026"}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Total Seats</span>
            <input
              type="number"
              min={1}
              max={500}
              value={totalSeats}
              onChange={(e) => setTotalSeats(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Academic Year</span>
            <input
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              placeholder="2026-27"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="md:col-span-4">
            <button className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">
              Add {labels.section_entity}
            </button>
          </div>
        </form>

        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}
      </SectionCard>

      <SectionCard title={`${labels.class_entity}s & ${labels.section_entity}s`} description="Current structure">
        <div className="grid gap-3 md:grid-cols-2">
          {filteredSections.map((section) => (
            <article key={section.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-800">{section.name}</p>
              <p className="text-slate-600">
                {labels.class_entity}: {classById.get(section.classId) ?? "Unknown"}
              </p>
              <p className="text-slate-600">
                Seats: {section.filledSeats}/{section.totalSeats} (Available {section.availableSeats})
              </p>
              <p className="text-xs text-slate-500">Academic Year: {section.academicYear || "N/A"}</p>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
