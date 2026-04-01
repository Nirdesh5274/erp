"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface MonitorRow {
  roomId: string;
  roomName: string;
  roomType: string;
  roomCapacity: number;
  status: "Occupied" | "Vacant";
  currentLectureId: string | null;
  updatedAt: string;
}

export default function AdminClassMonitorPage() {
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");

  const load = async () => {
    setError("");
    try {
      const data = await apiFetch<MonitorRow[]>("/api/admin/class-monitor");
      setRows(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load class monitor");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateStatus = async (roomId: string, status: "Occupied" | "Vacant", currentLectureId: string | null) => {
    setUpdatingId(roomId);
    setError("");
    try {
      await apiFetch<MonitorRow>("/api/admin/class-monitor", {
        method: "PATCH",
        body: JSON.stringify({ roomId, status, currentLectureId }),
      });
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update class monitor");
    } finally {
      setUpdatingId("");
    }
  };

  return (
    <SectionCard title="Class Monitor" description="Live room occupancy and status controls">
      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
      <div className="space-y-3">
        {rows.map((item) => (
          <div key={item.roomId} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">{item.roomName}</p>
            <p className="text-slate-600">Type: {item.roomType} • Capacity: {item.roomCapacity}</p>
            <p className={item.status === "Occupied" ? "text-amber-700" : "text-emerald-700"}>Status: {item.status}</p>
            <p className="text-xs text-slate-500">Updated: {new Date(item.updatedAt).toLocaleString()}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void updateStatus(item.roomId, "Occupied", item.currentLectureId)}
                disabled={updatingId === item.roomId}
                className="rounded-lg bg-amber-600 px-3 py-1 font-semibold text-white disabled:opacity-60"
              >
                Occupied
              </button>
              <button
                onClick={() => void updateStatus(item.roomId, "Vacant", null)}
                disabled={updatingId === item.roomId}
                className="rounded-lg bg-emerald-600 px-3 py-1 font-semibold text-white disabled:opacity-60"
              >
                Vacant
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
