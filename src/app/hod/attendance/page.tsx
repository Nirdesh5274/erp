"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

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

interface LocksResponse {
  lectures: LockedLecture[];
  departmentId: string | null;
}

export default function HodAttendanceLocksPage() {
  const [locks, setLocks] = useState<LockedLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const load = async (departmentId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const query = departmentId ? `?departmentId=${departmentId}` : "";
      const data = await apiFetch<LocksResponse>(`/api/hod/attendance/locks${query}`);
      setLocks(data.lectures);
      setFilterDept(data.departmentId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load locks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const unlock = async (lectureId: string) => {
    setActioning(lectureId);
    setError(null);
    try {
      await apiFetch("/api/hod/attendance/locks", {
        method: "PATCH",
        body: JSON.stringify({ lectureId, action: "unlock" }),
      });
      await load(filterDept);
      toast.success("Attendance unlocked");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to unlock attendance";
      setError(message);
      toast.error(message);
    } finally {
      setActioning(null);
    }
  };

  const lock = async (lectureId: string, reason: string) => {
    setActioning(lectureId);
    setError(null);
    try {
      await apiFetch("/api/hod/attendance/locks", {
        method: "PATCH",
        body: JSON.stringify({ lectureId, action: "lock", reason }),
      });
      await load(filterDept);
      toast.success("Attendance locked");
      setReasonById((prev) => ({ ...prev, [lectureId]: "" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to lock attendance";
      setError(message);
      toast.error(message);
    } finally {
      setActioning(null);
    }
  };

  const summary = useMemo(() => ({ total: locks.length }), [locks]);

  if (loading && locks.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <SectionCard title="Attendance Locks" description="Unlock or relock attendance windows for lectures in your department">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <button
          onClick={() => void load(filterDept)}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        {filterDept ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Dept scoped</span> : null}
        <span className="text-xs text-slate-500">Total locked: {summary.total}</span>
      </div>
      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
      <div className="space-y-3">
        {locks.map((lockItem) => {
          const expires = lockItem.attendanceLockExpiresAt ? new Date(lockItem.attendanceLockExpiresAt) : null;
          return (
            <div key={lockItem.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-800">{lockItem.subjectName || "Unassigned Subject"}</p>
                  <p className="text-xs text-slate-600">Room {lockItem.roomName} · {new Date(lockItem.startsAt).toLocaleString()}</p>
                  <p className="text-xs text-slate-600">Faculty: {lockItem.facultyName} ({lockItem.facultyEmail})</p>
                  {lockItem.attendanceLockReason ? (
                    <p className="text-xs text-amber-700">Reason: {lockItem.attendanceLockReason}</p>
                  ) : null}
                  {expires ? (
                    <p className="text-xs text-slate-600">Lock expires: {expires.toLocaleString()}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <input
                    value={reasonById[lockItem.id] ?? "Locked by HOD"}
                    onChange={(e) => setReasonById((prev) => ({ ...prev, [lockItem.id]: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    placeholder="Lock reason"
                  />
                  <button
                    onClick={() => void unlock(lockItem.id)}
                    disabled={actioning === lockItem.id}
                    className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Unlock
                  </button>
                  <button
                    onClick={() => void lock(lockItem.id, reasonById[lockItem.id] ?? "Locked by HOD")}
                    disabled={actioning === lockItem.id}
                    className="rounded-lg bg-slate-800 px-3 py-2 font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                  >
                    Re-lock
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {locks.length === 0 && !loading ? (
        <p className="text-sm text-slate-600">No locked lectures right now.</p>
      ) : null}
    </SectionCard>
  );
}
