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

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(0);
  const [systems, setSystems] = useState(0);
  const [workingSystems, setWorkingSystems] = useState(0);
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
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      await apiFetch<LabRow>("/api/admin/labs", {
        method: "POST",
        body: JSON.stringify({
          name,
          capacity,
          systems,
          workingSystems,
          internet,
          labAssistant: labAssistant || null,
          blockId: blockId || null,
        }),
      });
      setName("");
      setCapacity(0);
      setSystems(0);
      setWorkingSystems(0);
      setLabAssistant("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create lab");
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Add Lab" description="Configure systems, internet, and lab assistant">
        <form onSubmit={handleCreate} className="grid gap-3 text-sm md:grid-cols-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab name" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} placeholder="Capacity" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="number" min={0} value={systems} onChange={(e) => setSystems(Number(e.target.value))} placeholder="Total systems" className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="number" min={0} value={workingSystems} onChange={(e) => setWorkingSystems(Number(e.target.value))} placeholder="Working systems" className="rounded-xl border border-slate-300 px-3 py-2" required />
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
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800">Add Lab</button>
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
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
