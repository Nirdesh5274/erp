"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { PageSkeleton, TableSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface AttendanceSummary {
  attendance: {
    total: number;
    byStatus: Record<string, number>;
  };
  lockedLectures: number;
  todaysLectures: number;
  openAlerts: number;
}

interface LocksResponse {
  lectures: LockedLecture[];
}

interface LockedLecture {
  id: string;
  subjectId: string | null;
  subjectName: string;
  facultyId: string;
  facultyName: string;
  facultyEmail: string;
  roomId: string;
  roomName: string;
  startsAt: string;
  attendanceLockReason: string | null;
  attendanceLockExpiresAt: string | null;
  attendanceLockedBy: string | null;
}

interface StatusRow {
  key: string;
  label: string;
  count: number;
  percent: number;
}

export default function AdminAttendancePage() {
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locks, setLocks] = useState<LockedLecture[]>([]);
  const [locksLoading, setLocksLoading] = useState(false);
  const [locksError, setLocksError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        const data = await apiFetch<AttendanceSummary>("/api/admin/attendance/summary");
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load attendance summary");
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const loadLocks = async () => {
      setLocksLoading(true);
      setLocksError(null);
      try {
        const data = await apiFetch<LocksResponse>("/api/admin/attendance/locks");
        setLocks(data.lectures);
      } catch (err) {
        setLocksError(err instanceof Error ? err.message : "Unable to load locks");
      } finally {
        setLocksLoading(false);
      }
    };

    void loadLocks();
  }, []);

  const unlock = async (lectureId: string) => {
    setActioningId(lectureId);
    setLocksError(null);
    try {
      await apiFetch("/api/admin/attendance/locks", {
        method: "PATCH",
        body: JSON.stringify({ lectureId, action: "unlock" }),
      });
      const data = await apiFetch<LocksResponse>("/api/admin/attendance/locks");
      setLocks(data.lectures);
    } catch (err) {
      setLocksError(err instanceof Error ? err.message : "Unable to unlock attendance");
    } finally {
      setActioningId(null);
    }
  };

  const statusRows = useMemo<StatusRow[]>(() => {
    const byStatus = summary?.attendance.byStatus ?? {};
    const total = summary?.attendance.total ?? 0;
    const order = [
      "present",
      "absent",
      "late",
      "half_day",
      "on_duty",
      "medical_leave",
      "unknown",
    ];

    const labels: Record<string, string> = {
      present: "Present",
      absent: "Absent",
      late: "Late",
      half_day: "Half Day",
      on_duty: "On Duty",
      medical_leave: "Medical Leave",
      unknown: "Unknown",
    };

    return order.map((key) => {
      const count = byStatus[key] ?? 0;
      const percent = total ? Math.round((count / total) * 100) : 0;
      return { key, label: labels[key] ?? key, count, percent };
    });
  }, [summary]);

  const stats = useMemo(
    () => [
      { label: "Attendance records (7d)", value: summary?.attendance.total ?? 0, trend: "Last 7 days" },
      { label: "Locked lectures", value: summary?.lockedLectures ?? 0, trend: "Need unlock" },
      { label: "Today's lectures", value: summary?.todaysLectures ?? 0, trend: "Scheduled today" },
      { label: "Open alerts", value: summary?.openAlerts ?? 0, trend: "Monitoring unresolved" },
    ],
    [summary],
  );

  if (!summary && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Attendance</p>
          <h1 className="text-2xl font-black text-slate-900">Admin overview</h1>
        </div>
        <div className="text-xs text-slate-500">Pulled from attendance summary API</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} trend={stat.trend} />
        ))}
      </div>

      <SectionCard title="Status mix" description="Last 7 days attendance distribution">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-800">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Count</th>
                <th className="py-2 font-semibold">Percent</th>
              </tr>
            </thead>
            <tbody>
              {statusRows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">{row.label}</td>
                  <td className="py-2 pr-4 font-semibold">{row.count}</td>
                  <td className="py-2 text-slate-600">{row.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Locked lectures" description="Unlock windows that need admin attention">
        {locksError ? <p className="mb-3 text-sm text-rose-700">{locksError}</p> : null}
        {locksLoading ? <TableSkeleton rows={4} /> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-800">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2 pr-4 font-semibold">Lecture</th>
                <th className="py-2 pr-4 font-semibold">Faculty</th>
                <th className="py-2 pr-4 font-semibold">Room</th>
                <th className="py-2 pr-4 font-semibold">Reason</th>
                <th className="py-2 pr-4 font-semibold">Window</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {locks.map((lock) => {
                const expires = lock.attendanceLockExpiresAt ? new Date(lock.attendanceLockExpiresAt) : null;
                return (
                  <tr key={lock.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4">
                      <p className="font-semibold">{lock.subjectName || "Unassigned Subject"}</p>
                      <p className="text-xs text-slate-600">{new Date(lock.startsAt).toLocaleString()}</p>
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-700">{lock.facultyName} ({lock.facultyEmail})</td>
                    <td className="py-2 pr-4 text-xs text-slate-700">{lock.roomName || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-amber-700">{lock.attendanceLockReason ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs text-slate-600">{expires ? `Expires ${expires.toLocaleString()}` : "—"}</td>
                    <td className="py-2 text-xs">
                      <button
                        onClick={() => void unlock(lock.id)}
                        disabled={actioningId === lock.id}
                        className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {actioningId === lock.id ? "Unlocking..." : "Unlock"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!locks.length && !locksLoading ? <p className="text-sm text-slate-600">No locked lectures right now.</p> : null}
      </SectionCard>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
