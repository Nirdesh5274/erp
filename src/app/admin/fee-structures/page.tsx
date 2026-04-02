"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";
import { useInstitutionType } from "@/hooks/useInstitutionType";

interface FeeComponent {
  id?: string;
  componentKey: string;
  componentName: string;
  amount: number;
  sortOrder?: number;
}

interface FeeStructure {
  id: string;
  slotId: string | null;
  semester: number | null;
  classId: string | null;
  term: string | null;
  name: string;
  description: string | null;
  academicYear: string;
  isActive: boolean;
  components: FeeComponent[];
  updatedAt: string;
}

interface SlotRow {
  id: string;
  course: string;
}

interface ClassRow {
  id: string;
  name: string;
}

export default function AdminFeeStructuresPage() {
  const { isSchool } = useInstitutionType();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [slotId, setSlotId] = useState("");
  const [classId, setClassId] = useState("");
  const [semester, setSemester] = useState(1);
  const [term, setTerm] = useState("Annual");
  const [components, setComponents] = useState<FeeComponent[]>([
    { componentKey: "tuition_fee", componentName: "Tuition Fee", amount: 0, sortOrder: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot.course])), [slots]);
  const classById = useMemo(() => new Map(classes.map((row) => [row.id, row.name])), [classes]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [structureData, optionData] = await Promise.all([
        apiFetch<FeeStructure[]>("/api/admin/fee-structures"),
        isSchool ? apiFetch<ClassRow[]>("/api/admin/classes") : apiFetch<SlotRow[]>("/api/admin/slots"),
      ]);
      setStructures(structureData);
      if (isSchool) {
        setClasses(optionData as ClassRow[]);
        setSlots([]);
      } else {
        setSlots(optionData as SlotRow[]);
        setClasses([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load fee structures");
    } finally {
      setLoading(false);
    }
  }, [isSchool]);

  useEffect(() => {
    void load();
  }, [load]);

  const setComponentField = (index: number, patch: Partial<FeeComponent>) => {
    setComponents((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const addComponent = () => {
    setComponents((prev) => [
      ...prev,
      { componentKey: "", componentName: "", amount: 0, sortOrder: prev.length },
    ]);
  };

  const removeComponent = (index: number) => {
    setComponents((prev) => prev.filter((_, idx) => idx !== index).map((item, idx) => ({ ...item, sortOrder: idx })));
  };

  const handleCreateStructure = async () => {
    const hasTarget = isSchool ? Boolean(classId) : Boolean(slotId);
    if (!name.trim() || !academicYear.trim() || !hasTarget) return;
    if (components.length === 0 || components.some((component) => !component.componentName.trim())) {
      toast.error("Each component needs a name and amount");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/admin/fee-structures", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          academicYear: academicYear.trim(),
          ...(isSchool
            ? { classId, term: term.trim() }
            : { slotId, semester }),
          isActive: true,
          components: components.map((component, idx) => ({
            componentKey: component.componentKey.trim() || component.componentName,
            componentName: component.componentName.trim(),
            amount: Number(component.amount ?? 0),
            sortOrder: idx,
          })),
        }),
      });

      setName("");
      setDescription("");
      setAcademicYear("");
      setSlotId("");
      setClassId("");
      setSemester(1);
      setTerm("Annual");
      setComponents([{ componentKey: "tuition_fee", componentName: "Tuition Fee", amount: 0, sortOrder: 0 }]);
      await load();
      toast.success(
        isSchool
          ? "Fee structure saved and auto-applied to matching class and term students"
          : "Fee structure saved and auto-applied to matching semester students",
      );
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to create structure";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (structure: FeeStructure) => {
    try {
      await apiFetch(`/api/admin/fee-structures/${structure.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !structure.isActive }),
      });
      await load();
      toast.success(structure.isActive ? "Structure disabled" : "Structure enabled");
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : "Unable to update structure";
      setError(message);
      toast.error(message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/admin/fee-structures/${id}`, { method: "DELETE" });
      await load();
      toast.success("Structure deleted");
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Unable to delete structure";
      setError(message);
      toast.error(message);
    }
  };

  if (loading && structures.length === 0 && !error) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <SectionCard title="Create Fee Structure" description={isSchool ? "Class-wise master setup with reusable components" : "Slot-wise master setup with reusable components"}>
        <div className="grid gap-3 md:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Structure name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (shown in receipt)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            placeholder="Academic year (2026-2027)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {isSchool ? (
            <>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Select class</option>
                {classes.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
              <select value={term} onChange={(e) => setTerm(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="Annual">Annual</option>
                <option value="Term 1">Term 1</option>
                <option value="Term 2">Term 2</option>
                <option value="Term 3">Term 3</option>
              </select>
            </>
          ) : (
            <>
              <select value={slotId} onChange={(e) => setSlotId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Select slot</option>
                {slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>{slot.course}</option>
                ))}
              </select>
              <select value={semester} onChange={(e) => setSemester(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {Array.from({ length: 12 }, (_, index) => {
                  const sem = index + 1;
                  return (
                    <option key={sem} value={sem}>
                      Semester {sem}
                    </option>
                  );
                })}
              </select>
            </>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {components.map((component, index) => (
            <div key={`${component.componentKey}-${index}`} className="grid gap-2 md:grid-cols-12">
              <input
                value={component.componentName}
                onChange={(e) => setComponentField(index, { componentName: e.target.value })}
                placeholder="Component name (e.g. Tuition Fee, Lab Fee)"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-7"
              />
              <input
                type="number"
                min={0}
                value={component.amount}
                onChange={(e) => setComponentField(index, { amount: Number(e.target.value) })}
                placeholder="Amount (₹)"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-4"
              />
              <button
                onClick={() => removeComponent(index)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 md:col-span-1"
                disabled={components.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={addComponent} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Add component
          </button>
          <button
            onClick={() => void handleCreateStructure()}
            disabled={saving || !name || !academicYear || (isSchool ? !classId : !slotId)}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save structure"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          {isSchool
            ? "On save, this structure is automatically applied to students of selected class and term."
            : "On save, this structure is automatically applied to students of selected slot and semester."}
        </p>
      </SectionCard>

      <SectionCard title="Saved Structures" description="Toggle active state or remove legacy templates">
        <div className="space-y-3 text-sm">
          {structures.map((structure) => (
            <div key={structure.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{structure.name}</p>
                  <p className="text-xs text-slate-600">
                    {isSchool
                      ? `${structure.academicYear} · ${structure.term ?? "Term N/A"} · ${classById.get(structure.classId ?? "") ?? "Unknown class"} · ${structure.components.length} components`
                      : `${structure.academicYear} · Sem ${structure.semester ?? "N/A"} · ${slotById.get(structure.slotId ?? "") ?? "Unknown slot"} · ${structure.components.length} components`}
                  </p>
                  {structure.description ? <p className="text-xs text-slate-600">{structure.description}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className={structure.isActive ? "text-emerald-700" : "text-slate-500"}>{structure.isActive ? "Active" : "Inactive"}</span>
                  <button
                    onClick={() => void handleToggleActive(structure)}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {structure.isActive ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => void handleDelete(structure.id)}
                    className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-700">
                {structure.components.map((component) => (
                  <p key={component.id ?? component.componentKey}>
                    {component.componentName}: ₹{Number(component.amount ?? 0).toLocaleString("en-IN")}
                  </p>
                ))}
              </div>
            </div>
          ))}
          {structures.length === 0 ? <p className="text-xs text-slate-600">No structures found.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
