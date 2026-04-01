"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface RoomRow {
  id: string;
  name: string;
  room_type: "Classroom" | "Lab" | "Auditorium" | "Library";
  capacity: number;
  benches: number;
  block_id: string | null;
}

interface BlockRow {
  id: string;
  name: string;
}

export default function AdminRoomsPage() {
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [blockId, setBlockId] = useState("");
  const [roomType, setRoomType] = useState<RoomRow["room_type"]>("Classroom");
  const [capacity, setCapacity] = useState(0);
  const [benches, setBenches] = useState(0);

  const blockById = useMemo(() => new Map(blocks.map((item) => [item.id, item.name])), [blocks]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [roomData, blockData] = await Promise.all([
        apiFetch<RoomRow[]>("/api/admin/rooms"),
        apiFetch<BlockRow[]>("/api/admin/blocks"),
      ]);
      setRooms(roomData);
      setBlocks(blockData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load rooms");
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
      await apiFetch<RoomRow>("/api/admin/rooms", {
        method: "POST",
        body: JSON.stringify({
          name,
          blockId: blockId || null,
          roomType,
          capacity,
          benches,
        }),
      });
      setName("");
      setCapacity(0);
      setBenches(0);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create room");
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Add Room" description="Create classroom, lab, auditorium, or library">
        <form onSubmit={handleCreate} className="grid gap-3 text-sm md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Room Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. C-301" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Block</span>
            <select value={blockId} onChange={(e) => setBlockId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
              <option value="">No block</option>
              {blocks.map((block) => (
                <option key={block.id} value={block.id}>{block.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Room Type</span>
            <select value={roomType} onChange={(e) => setRoomType(e.target.value as RoomRow["room_type"])} className="w-full rounded-xl border border-slate-300 px-3 py-2">
              <option value="Classroom">Classroom</option>
              <option value="Lab">Lab</option>
              <option value="Auditorium">Auditorium</option>
              <option value="Library">Library</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Capacity (Students)</span>
            <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} placeholder="0" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Benches</span>
            <input type="number" min={0} value={benches} onChange={(e) => setBenches(Number(e.target.value))} placeholder="0" className="w-full rounded-xl border border-slate-300 px-3 py-2" required />
          </label>
          <button className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 md:self-end">Add Room</button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Rooms" description="Room inventory and capacity tracking">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Room</th>
                <th className="py-2">Type</th>
                <th className="py-2">Block</th>
                <th className="py-2">Capacity</th>
                <th className="py-2">Benches</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-2 font-semibold">{room.name}</td>
                  <td className="py-2">{room.room_type}</td>
                  <td className="py-2">{room.block_id ? blockById.get(room.block_id) ?? "-" : "-"}</td>
                  <td className="py-2">{room.capacity}</td>
                  <td className="py-2">{room.benches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
