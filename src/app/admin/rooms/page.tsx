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
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [blockId, setBlockId] = useState("");
  const [roomType, setRoomType] = useState<RoomRow["room_type"]>("Classroom");
  const [capacity, setCapacity] = useState("");
  const [benches, setBenches] = useState("");

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
    void load();
  }, [load]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (name.trim().length === 0) {
      setError("Room name is required");
      return;
    }

    const parsedCapacity = Number(capacity);
    const parsedBenches = Number(benches);
    if (!Number.isFinite(parsedCapacity) || parsedCapacity < 0) {
      setError("Capacity must be 0 or greater");
      return;
    }
    if (!Number.isFinite(parsedBenches) || parsedBenches < 0) {
      setError("Benches must be 0 or greater");
      return;
    }

    try {
      setSaving(true);
      await apiFetch<RoomRow>("/api/admin/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          blockId: blockId || null,
          roomType,
          capacity: parsedCapacity,
          benches: parsedBenches,
        }),
      });
      setName("");
      setCapacity("");
      setBenches("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create room");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (room: RoomRow) => {
    setEditingId(room.id);
    setName(room.name);
    setBlockId(room.block_id ?? "");
    setRoomType(room.room_type);
    setCapacity(String(room.capacity ?? 0));
    setBenches(String(room.benches ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName("");
    setBlockId("");
    setRoomType("Classroom");
    setCapacity("");
    setBenches("");
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) return;

    setError("");
    if (name.trim().length === 0) {
      setError("Room name is required");
      return;
    }

    const parsedCapacity = Number(capacity);
    const parsedBenches = Number(benches);
    if (!Number.isFinite(parsedCapacity) || parsedCapacity < 0) {
      setError("Capacity must be 0 or greater");
      return;
    }
    if (!Number.isFinite(parsedBenches) || parsedBenches < 0) {
      setError("Benches must be 0 or greater");
      return;
    }

    try {
      setSaving(true);
      await apiFetch<RoomRow>("/api/admin/rooms", {
        method: "PATCH",
        body: JSON.stringify({
          id: editingId,
          name: name.trim(),
          blockId: blockId || null,
          roomType,
          capacity: parsedCapacity,
          benches: parsedBenches,
        }),
      });
      cancelEdit();
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update room");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this room?")) return;
    setError("");
    try {
      setSaving(true);
      await apiFetch<{ deleted: boolean; id: string }>(`/api/admin/rooms?id=${id}`, { method: "DELETE" });
      if (editingId === id) cancelEdit();
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete room");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title={editingId ? "Edit Room" : "Add Room"}
        description={editingId ? "Update room details" : "Create classroom, lab, auditorium, or library"}
      >
        <form onSubmit={editingId ? handleUpdate : handleCreate} className="grid gap-3 text-sm md:grid-cols-3">
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
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Enter capacity"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Benches</span>
            <input
              type="number"
              min={0}
              value={benches}
              onChange={(e) => setBenches(e.target.value)}
              placeholder="Enter benches"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
          </label>
          <div className="flex items-end gap-2 md:self-end">
            <button
              disabled={saving}
              className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : editingId ? "Update Room" : "Add Room"}
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
                <th className="py-2 text-right">Actions</th>
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
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(room)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(room.id)}
                        className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
