"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface LabRow {
  id: string;
  name: string;
  capacity: number;
  systems: number;
  working_systems: number;
  internet: boolean;
  lab_assistant: string | null;
  block_id: string | null;
}

interface BlockRow {
  id: string;
  name: string;
}

export default function AdminLabsPage() {
  const [labs, setLabs] = useState<LabRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [systems, setSystems] = useState("");
  const [workingSystems, setWorkingSystems] = useState("");
  const [internet, setInternet] = useState(true);
  const [labAssistant, setLabAssistant] = useState("");
  const [blockId, setBlockId] = useState("");

  const blockById = useMemo(() => new Map(blocks.map((item) => [item.id, item.name])), [blocks]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [labData, blockData] = await Promise.all([
        apiFetch<LabRow[]>("/api/admin/labs"),
        apiFetch<BlockRow[]>("/api/admin/blocks"),
      ]);
      setLabs(labData);
      setBlocks(blockData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load labs");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (name.trim().length === 0) {
      setError("Lab name is required");
      return;
    }

    const parsedCapacity = Number(capacity);
    const parsedSystems = Number(systems);
    const parsedWorkingSystems = Number(workingSystems);
    if (!Number.isFinite(parsedCapacity) || parsedCapacity < 0) {
      setError("Capacity must be 0 or greater");
      return;
    }
    if (!Number.isFinite(parsedSystems) || parsedSystems < 0) {
      setError("Systems must be 0 or greater");
      return;
    }
    if (!Number.isFinite(parsedWorkingSystems) || parsedWorkingSystems < 0) {
      setError("Working systems must be 0 or greater");
      return;
    }

    try {
      setSaving(true);
      await apiFetch<LabRow>("/api/admin/labs", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          capacity: parsedCapacity,
          systems: parsedSystems,
          workingSystems: parsedWorkingSystems,
          internet,
          labAssistant: labAssistant.trim() || null,
          blockId: blockId || null,
        }),
      });
      setName("");
      setCapacity("");
      setSystems("");
      setWorkingSystems("");
      setLabAssistant("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create lab");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (lab: LabRow) => {
    setEditingId(lab.id);
    setName(lab.name);
    setCapacity(String(lab.capacity ?? 0));
    setSystems(String(lab.systems ?? 0));
    setWorkingSystems(String(lab.working_systems ?? 0));
    setInternet(Boolean(lab.internet));
    setLabAssistant(lab.lab_assistant ?? "");
    setBlockId(lab.block_id ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName("");
    setCapacity("");
    setSystems("");
    setWorkingSystems("");
    setInternet(true);
    setLabAssistant("");
    setBlockId("");
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) return;

    setError("");
    if (name.trim().length === 0) {
      setError("Lab name is required");
      return;
    }

    const parsedCapacity = Number(capacity);
    const parsedSystems = Number(systems);
    const parsedWorkingSystems = Number(workingSystems);
    if (!Number.isFinite(parsedCapacity) || parsedCapacity < 0) {
      setError("Capacity must be 0 or greater");
      return;
    }
    if (!Number.isFinite(parsedSystems) || parsedSystems < 0) {
      setError("Systems must be 0 or greater");
      return;
    }
    if (!Number.isFinite(parsedWorkingSystems) || parsedWorkingSystems < 0) {
      setError("Working systems must be 0 or greater");
      return;
    }

    try {
      setSaving(true);
      await apiFetch<LabRow>("/api/admin/labs", {
        method: "PATCH",
        body: JSON.stringify({
          id: editingId,
          name: name.trim(),
          capacity: parsedCapacity,
          systems: parsedSystems,
          workingSystems: parsedWorkingSystems,
          internet,
          labAssistant: labAssistant.trim() || null,
          blockId: blockId || null,
        }),
      });
      cancelEdit();
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update lab");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this lab?")) return;

    setError("");
    try {
      setSaving(true);
      await apiFetch<{ deleted: boolean; id: string }>(`/api/admin/labs?id=${id}`, { method: "DELETE" });
      if (editingId === id) cancelEdit();
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete lab");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title={editingId ? "Edit Lab" : "Add Lab"}
        description={editingId ? "Update systems, internet, and lab assistant" : "Configure systems, internet, and lab assistant"}
      >
        <form onSubmit={editingId ? handleUpdate : handleCreate} className="grid gap-3 text-sm md:grid-cols-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab name" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="number" min={0} value={systems} onChange={(e) => setSystems(e.target.value)} placeholder="Total systems" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="number" min={0} value={workingSystems} onChange={(e) => setWorkingSystems(e.target.value)} placeholder="Working systems" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input value={labAssistant} onChange={(e) => setLabAssistant(e.target.value)} placeholder="Lab assistant" className="rounded-xl border border-slate-300 px-3 py-2" />
          <select value={blockId} onChange={(e) => setBlockId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2">
            <option value="">No block</option>
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>{block.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2">
            <input type="checkbox" checked={internet} onChange={(e) => setInternet(e.target.checked)} />
            Internet Enabled
          </label>
          <div className="flex gap-2">
            <button
              disabled={saving}
              className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : editingId ? "Update Lab" : "Add Lab"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Labs" description="Lab allocation and system availability">
        <div className="grid gap-4 md:grid-cols-3">
          {labs.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-lg font-bold text-slate-800">{item.name}</h3>
              <p className="text-sm text-slate-600">Block: {item.block_id ? blockById.get(item.block_id) ?? "-" : "-"}</p>
              <p className="text-sm text-teal-700">Systems: {item.working_systems}/{item.systems}</p>
              <p className="text-sm text-slate-600">Internet: {item.internet ? "Yes" : "No"}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(item)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
