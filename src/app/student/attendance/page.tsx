"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface AttendanceSummary {
  attendancePercent: number;
  totalMarked: number;
  presentCount: number;
  requiredFor75: number;
  perSubject: Array<{ subjectId: string | null; subjectName: string; percent: number; present: number; total: number }>;
  calendar: Array<{ date: string; status: string }>;
}

const statusColor: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-700",
  absent: "bg-rose-100 text-rose-700",
  on_duty: "bg-sky-100 text-sky-700",
  medical_leave: "bg-amber-100 text-amber-800",
  late: "bg-indigo-100 text-indigo-700",
  half_day: "bg-slate-200 text-slate-700",
  none: "bg-slate-100 text-slate-500",
};

function AttendanceGauge({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const angle = (clamped / 100) * 360;
  return (
    <div className="relative h-28 w-28">
      <div
        className="h-full w-full rounded-full"
        style={{ background: `conic-gradient(#0ea5e9 ${angle}deg, #e2e8f0 0deg)` }}
      />
      <div className="absolute inset-4 flex items-center justify-center rounded-full bg-white text-xl font-black text-slate-800">
        {clamped}%
      </div>
    </div>
  );
}

export default function StudentAttendancePage() {
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AttendanceSummary>("/api/student/attendance/summary");
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const monthDays = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, []);

  const heatmap = useMemo(() => {
    const statusByDay = new Map<number, string>();
    for (const entry of summary?.calendar ?? []) {
      const day = new Date(entry.date).getDate();
      statusByDay.set(day, entry.status);
    }
    return monthDays.map((day) => ({ day, status: statusByDay.get(day) ?? "none" }));
  }, [summary, monthDays]);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Attendance tracker"
        description="Overall health, per subject breakdown, and calendar"
        actionSlot={
          <button
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        }
      >
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-6">
          <AttendanceGauge percent={summary?.attendancePercent ?? 0} />
          <div className="space-y-2 text-sm text-slate-700">
            <p className="text-lg font-black text-slate-900">{summary?.attendancePercent ?? 0}% overall</p>
            <p>
              {summary?.presentCount ?? 0}/{summary?.totalMarked ?? 0} marked • Need {summary?.requiredFor75 ?? 0} more to reach 75%
            </p>
            <p className="text-xs text-slate-500">Auto-calculated from lecture attendance</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Subject-wise" description="Progress bars per subject">
        <div className="space-y-3 text-sm text-slate-700">
          {(summary?.perSubject ?? []).map((item) => (
            <div key={item.subjectId ?? item.subjectName}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">{item.subjectName}</p>
                <p className="text-slate-700">{item.percent}% · {item.present}/{item.total}</p>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-sky-500" style={{ width: `${item.percent}%` }} />
              </div>
            </div>
          ))}
          {(summary?.perSubject ?? []).length === 0 ? <p className="text-xs text-slate-600">No subject attendance records yet.</p> : null}
        </div>
      </SectionCard>

      <SectionCard title="Monthly calendar" description="Heatmap of current month">
        <div className="grid grid-cols-7 gap-2 text-center text-xs">
          {heatmap.map((cell) => (
            <div key={cell.day} className={`rounded-lg px-2 py-3 font-semibold ${statusColor[cell.status] ?? statusColor.none}`}>
              {cell.day}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
          {Object.entries(statusColor).map(([status, cls]) => (
            <span key={status} className={`rounded-full px-3 py-1 ${cls}`}>
              {status.replace("_", " ")}
            </span>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
