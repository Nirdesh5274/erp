"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface LectureItem {
  id: string;
  departmentName: string;
  subjectName: string;
  facultyName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  liveStatus: string;
  alerts: number;
}

interface ScheduleResponse {
  lectures: LectureItem[];
}

export default function StudentSchedulePage() {
  const [items, setItems] = useState<LectureItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: new Date().toISOString() });
      const data = await apiFetch<ScheduleResponse>(`/api/hod/schedule?${params.toString()}`);
      setItems(data.lectures ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load schedule");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <SectionCard title="My Schedule" description="Upcoming lectures for your college">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-600">
          <button
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 px-3 py-1 font-semibold text-slate-700"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <span>{items.length} upcoming</span>
        </div>
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <div className="space-y-3 text-sm">
          {items.map((lecture) => (
            <div key={lecture.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{lecture.departmentName}</p>
              <p className="text-base font-semibold text-slate-900">{lecture.subjectName || "Lecture"}</p>
              <p className="text-slate-700">Faculty: {lecture.facultyName}</p>
              <p className="text-slate-600">Room {lecture.roomName || "TBD"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="rounded-lg bg-slate-50 px-2 py-1 shadow">{new Date(lecture.startsAt).toLocaleString()} - {new Date(lecture.endsAt).toLocaleTimeString()}</span>
                <span className={`rounded-lg px-2 py-1 shadow ${lecture.liveStatus === "occupied" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                  {lecture.liveStatus}
                </span>
                {lecture.alerts > 0 ? (
                  <span className="rounded-lg bg-amber-100 px-2 py-1 text-amber-800">Alerts {lecture.alerts}</span>
                ) : null}
              </div>
            </div>
          ))}
          {items.length === 0 && !loading ? <p className="text-xs text-slate-600">No upcoming lectures.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
