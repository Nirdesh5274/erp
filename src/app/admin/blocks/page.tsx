"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface BlockRow {
  id: string;
  name: string;
  created_at: string;
}

interface RoomRow {
  id: string;
  name: string;
  room_type: "Classroom" | "Lab" | "Auditorium" | "Library";
  capacity: number;
  benches: number;
  systems: number;
  working_systems: number;
  internet: boolean;
  lab_assistant: string | null;
  block_id: string | null;
}

export default function AdminBlocksPage() {
  const [rows, setRows] = useState<BlockRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [blockData, roomData] = await Promise.all([
        apiFetch<BlockRow[]>("/api/admin/blocks"),
        apiFetch<RoomRow[]>("/api/admin/rooms"),
      ]);
      setRows(blockData);
      setRooms(roomData);
      setSelectedBlockId((current) => {
        if (current && blockData.some((block) => block.id === current)) return current;
        return blockData[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load blocks");
    } finally {
      setLoading(false);
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
      await apiFetch<BlockRow>("/api/admin/blocks", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setName("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create block");
    }
  };

  const selectedBlock = rows.find((item) => item.id === selectedBlockId) ?? null;
  const selectedRooms = useMemo(
    () => (selectedBlockId ? rooms.filter((room) => room.block_id === selectedBlockId) : []),
    [rooms, selectedBlockId],
  );

  const roomTypeSummary = useMemo(() => {
    const summary: Record<string, number> = {
      Classroom: 0,
      Lab: 0,
      Auditorium: 0,
      Library: 0,
    };
    for (const room of selectedRooms) {
      summary[room.room_type] = (summary[room.room_type] ?? 0) + 1;
    }
    return summary;
  }, [selectedRooms]);

  const totals = useMemo(
    () =>
      selectedRooms.reduce(
        (acc, room) => {
          acc.capacity += Number(room.capacity ?? 0);
          acc.benches += Number(room.benches ?? 0);
          acc.systems += Number(room.systems ?? 0);
          acc.workingSystems += Number(room.working_systems ?? 0);
          if (room.internet) acc.internetEnabled += 1;
          return acc;
        },
        { capacity: 0, benches: 0, systems: 0, workingSystems: 0, internetEnabled: 0 },
      ),
    [selectedRooms],
  );

  return (
    <div className="space-y-6">
      <SectionCard title="Add Block" description="Create infrastructure blocks (A, B, C)">
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 text-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Block name"
            className="rounded-xl border border-slate-300 px-3 py-2"
            required
          />
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800">Add Block</button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Infrastructure Blocks" description="Live block registry">
        {loading ? <p className="text-sm text-slate-500">Loading block registry...</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedBlockId(item.id)}
              className={`rounded-2xl border p-4 text-left transition ${
                selectedBlockId === item.id
                  ? "border-teal-400 bg-teal-50"
                  : "border-slate-200 bg-slate-50 hover:border-slate-300"
              }`}
            >
              <h3 className="text-lg font-bold text-slate-800">{item.name}</h3>
              <p className="text-sm text-teal-700">Created: {new Date(item.created_at).toLocaleDateString()}</p>
              <p className="mt-2 text-xs text-slate-600">
                Rooms: {rooms.filter((room) => room.block_id === item.id).length}
              </p>
            </button>
          ))}
        </div>
        {!loading && rows.length === 0 ? <p className="text-xs text-slate-600">No blocks found yet.</p> : null}
      </SectionCard>

      <SectionCard
        title="Block Insights"
        description={selectedBlock ? `Room-level details for Block ${selectedBlock.name}` : "Select a block to view room details"}
      >
        {!selectedBlock ? <p className="text-sm text-slate-600">Select any block from registry above.</p> : null}

        {selectedBlock ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="text-xs text-slate-500">Total Rooms</p>
                <p className="text-xl font-bold text-slate-900">{selectedRooms.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="text-xs text-slate-500">Total Capacity</p>
                <p className="text-xl font-bold text-slate-900">{totals.capacity}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="text-xs text-slate-500">Benches</p>
                <p className="text-xl font-bold text-slate-900">{totals.benches}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="text-xs text-slate-500">Systems Working</p>
                <p className="text-xl font-bold text-slate-900">{totals.workingSystems}/{totals.systems}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="text-xs text-slate-500">Internet Enabled</p>
                <p className="text-xl font-bold text-slate-900">{totals.internetEnabled}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Object.entries(roomTypeSummary).map(([type, count]) => (
                <div key={type} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                  <p className="text-xs text-slate-500">{type}</p>
                  <p className="text-lg font-bold text-slate-900">{count}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-3 py-2">Room</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Capacity</th>
                    <th className="px-3 py-2">Benches</th>
                    <th className="px-3 py-2">Systems</th>
                    <th className="px-3 py-2">Internet</th>
                    <th className="px-3 py-2">Lab Assistant</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRooms.map((room) => (
                    <tr key={room.id} className="border-b border-slate-100 text-slate-700">
                      <td className="px-3 py-2 font-semibold">{room.name}</td>
                      <td className="px-3 py-2">{room.room_type}</td>
                      <td className="px-3 py-2">{room.capacity}</td>
                      <td className="px-3 py-2">{room.benches}</td>
                      <td className="px-3 py-2">{room.working_systems}/{room.systems}</td>
                      <td className="px-3 py-2">{room.internet ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{room.lab_assistant || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selectedRooms.length === 0 ? <p className="mt-3 text-xs text-slate-600">No rooms assigned to this block yet.</p> : null}
            </div>
          </>
        ) : null}
      </SectionCard>
    </div>
  );
}
