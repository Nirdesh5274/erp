"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface LectureRow {
  id: string;
  starts_at: string;
  ends_at: string;
  room_id: string;
  attendance_locked?: boolean;
  attendance_lock_expires_at?: string | null;
}

interface AttendanceEntry {
  id: string;
  name: string;
  email: string;
  status: AttendanceStatus;
}

type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "on_duty" | "medical_leave";

const statusOptions: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "half_day", label: "Half Day" },
  { value: "on_duty", label: "On Duty" },
  { value: "medical_leave", label: "Medical Leave" },
];

export default function FacultyAttendancePage() {
  const [lectures, setLectures] = useState<LectureRow[]>([]);
  const [selectedLectureId, setSelectedLectureId] = useState("");
  const [students, setStudents] = useState<AttendanceEntry[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [lectureMeta, setLectureMeta] = useState<Partial<LectureRow> | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    const loadLectures = async () => {
      setError("");
      try {
        const lectureData = await apiFetch<LectureRow[]>("/api/faculty/lectures");
        setLectures(lectureData);
        if (lectureData[0]) setSelectedLectureId(lectureData[0].id);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load lectures");
      }
    };

    void loadLectures();
  }, []);

  useEffect(() => {
    const loadRoster = async () => {
      if (!selectedLectureId) {
        setStudents([]);
        return;
      }

      setError("");
      try {
        const roster = await apiFetch<{ lecture: LectureRow; roster: AttendanceEntry[] }>(
          `/api/faculty/attendance?lectureId=${selectedLectureId}`,
        );
        setLectureMeta(roster.lecture);
        setStudents(roster.roster);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load roster");
        setSuccess("");
      }
    };

    void loadRoster();
  }, [selectedLectureId]);

  const setStatus = (index: number, status: AttendanceStatus) => {
    setStudents((prev) => prev.map((item, i) => (i === index ? { ...item, status } : item)));
  };

  const markAll = (status: AttendanceStatus) => {
    setStudents((prev) => prev.map((item) => ({ ...item, status })));
  };

  const saveAttendance = async () => {
    if (!selectedLectureId) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      await apiFetch<{ saved: number }>("/api/faculty/attendance", {
        method: "POST",
        body: JSON.stringify({
          lectureId: selectedLectureId,
          attendanceDate: today,
          entries: students.map((item) => ({
            studentId: item.id,
            status: item.status,
          })),
          overrideReason: overrideReason.trim() || undefined,
        }),
      });
      setSuccess("Attendance saved");
      setOverrideReason("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save attendance");
    } finally {
      setSaving(false);
    }
  };

  const isLocked = lectureMeta?.attendance_locked;
  const expiresAt = lectureMeta?.attendance_lock_expires_at ? new Date(lectureMeta.attendance_lock_expires_at) : null;

  const summary = useMemo(() => {
    const total = students.length;
    const byStatus = students.reduce<Record<AttendanceStatus, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
      on_duty: 0,
      medical_leave: 0,
    });
    return { total, byStatus };
  }, [students]);

  const lockCountdown = useMemo(() => {
    if (!lectureMeta?.attendance_lock_expires_at) return "";
    const diff = new Date(lectureMeta.attendance_lock_expires_at).getTime() - Date.now();
    if (diff <= 0) return "Lock window closed";
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `Closes in ${minutes}m ${seconds}s`;
  }, [lectureMeta?.attendance_lock_expires_at]);

  return (
    <SectionCard title="Mark Attendance" description="Bulk mark attendance with extended statuses">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={selectedLectureId}
          onChange={(e) => setSelectedLectureId(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2"
        >
          <option value="">Select lecture</option>
          {lectures.map((lecture) => (
            <option key={lecture.id} value={lecture.id}>
              {new Date(lecture.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {new Date(lecture.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </option>
          ))}
        </select>
        <button
          onClick={() => void saveAttendance()}
          disabled={saving || !selectedLectureId || students.length === 0 || isLocked}
          className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Attendance"}
        </button>
        <button
          onClick={() => markAll("present")}
          disabled={!selectedLectureId || students.length === 0 || isLocked}
          className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Mark all Present
        </button>
        <button
          onClick={() => markAll("absent")}
          disabled={!selectedLectureId || students.length === 0 || isLocked}
          className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Mark all Absent
        </button>
      </div>
      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}
      {isLocked ? (
        <p className="mb-3 rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800">
          Attendance locked for this lecture{expiresAt ? ` (closed ${expiresAt.toLocaleString()})` : ""}.
        </p>
      ) : null}
      {!isLocked && lockCountdown ? (
        <p className="mb-3 rounded-xl bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800">{lockCountdown}</p>
      ) : null}
      <div className="mb-3 flex flex-col gap-2">
        <label className="text-sm font-semibold text-slate-700">Override note (optional)</label>
        <input
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
          placeholder="Reason for manual override or adjustments"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      {summary.total > 0 ? (
        <p className="mb-3 text-sm text-slate-600">
          Total {summary.total} · Present {summary.byStatus.present} · Absent {summary.byStatus.absent} · Late {summary.byStatus.late} · Half Day {summary.byStatus.half_day} · On Duty {summary.byStatus.on_duty} · Medical {summary.byStatus.medical_leave}
        </p>
      ) : null}
      <div className="space-y-3">
        {students.map((student, index) => (
          <div key={student.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="font-semibold text-slate-800">{student.name}</p>
            <select
              value={student.status}
              onChange={(e) => setStatus(index, e.target.value as AttendanceStatus)}
              disabled={isLocked}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
